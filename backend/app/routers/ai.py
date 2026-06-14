import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..routers.campaigns import _stats
from ..models import Campaign, Customer, Order, Segment
from ..schemas import (AIAskRequest, AIChatRequest, AIDraftRequest,
                       AISegmentRequest, RuleGroup)
from ..services import ai_service
from ..services.segment_engine import audience_count, audience_customers

# Anthropic models offered when that provider is configured.
ANTHROPIC_MODELS = ["claude-sonnet-4-6", "claude-opus-4-8",
                    "claude-haiku-4-5-20251001"]
# Substrings that mark non-chat models we hide from the picker.
_NON_CHAT = ("whisper", "tts", "guard", "embed", "vision-only")


def _apply_model_override(request: Request) -> None:
    """Router dependency: honour an X-AI-Model header for this request."""
    ai_service.set_model_override(request.headers.get("x-ai-model", ""))


router = APIRouter(prefix="/api/ai", tags=["ai"],
                   dependencies=[Depends(_apply_model_override)])


@router.get("/status")
def status():
    """Lets the frontend degrade gracefully when no API key is configured."""
    return {"enabled": bool(settings.ai_provider),
            "provider": settings.ai_provider,
            "model": settings.ai_model}


@router.get("/models")
def models():
    """The chat models the configured provider actually offers, so the UI
    picker is always live rather than a hardcoded guess."""
    provider = settings.ai_provider
    if provider == "anthropic":
        return {"models": ANTHROPIC_MODELS, "default": settings.ai_model}
    if provider == "openai":
        try:
            resp = httpx.get(
                settings.ai_base_url.rstrip("/") + "/models",
                headers={"Authorization": f"Bearer {settings.ai_api_key}"},
                timeout=15)
            resp.raise_for_status()
            ids = [m["id"] for m in resp.json().get("data", [])
                   if not any(tok in m["id"].lower() for tok in _NON_CHAT)]
            return {"models": sorted(ids) or [settings.ai_model],
                    "default": settings.ai_model}
        except httpx.HTTPError:
            return {"models": [settings.ai_model], "default": settings.ai_model}
    return {"models": [], "default": settings.ai_model}


@router.post("/segment")
def segment_from_text(body: AISegmentRequest, db: Session = Depends(get_db)):
    """NL -> structured rules -> live audience preview, in one round trip.

    The response is an editable artifact, not a fait accompli: the UI shows
    the rules and the preview, and the marketer can tweak before saving.
    """
    result = ai_service.segment_from_text(body.prompt)
    rules = RuleGroup.model_validate(result["rules"])
    sample = audience_customers(db, rules, limit=5)
    return {
        **result,
        "preview": {
            "count": audience_count(db, rules),
            "sample": [{"name": c.name, "email": c.email, "city": c.city}
                       for c in sample],
        },
    }


@router.post("/draft")
def draft(body: AIDraftRequest):
    return ai_service.draft_messages(
        body.objective, body.audience_description, body.channel)


def _analytics_context(db: Session) -> dict:
    """Compact, real aggregates the model can reason over for /ask."""
    customers = db.scalar(select(func.count()).select_from(Customer))
    orders = db.scalar(select(func.count()).select_from(Order))
    revenue = db.scalar(select(func.coalesce(func.sum(Order.amount), 0.0)))
    cats = db.execute(
        select(Order.category, func.count(), func.sum(Order.amount))
        .where(Order.category != "").group_by(Order.category)
        .order_by(func.sum(Order.amount).desc())).all()
    campaigns = []
    for c in db.execute(select(Campaign)).scalars():
        s = _stats(db, c)["stats"]
        campaigns.append({
            "name": c.name, "channel": c.channel,
            "audience": c.audience_size,
            "delivery_rate": s["delivery_rate"],
            "click_rate": s["click_rate"],
            "attributed_revenue": s["attributed_revenue"],
            "converted": s["funnel"]["converted"]})
    return {
        "customers": customers, "orders": orders, "revenue": round(revenue, 2),
        "categories": [{"name": c, "orders": n, "revenue": round(r, 2)}
                       for c, n, r in cats],
        "campaigns": campaigns,
    }


@router.post("/ask")
def ask(body: AIAskRequest, db: Session = Depends(get_db)):
    """Ask-your-data: natural-language analytics grounded in real aggregates."""
    return ai_service.answer_question(body.question, _analytics_context(db))


@router.post("/chat")
def chat(body: AIChatRequest, db: Session = Depends(get_db)):
    """One copilot turn: conversation in, reply + validated plan out.

    The copilot proposes; it cannot execute. When a plan comes back we
    attach a live audience preview so the marketer sees exactly who the
    proposal reaches before approving anything.
    """
    context = {
        "customers": db.scalar(select(func.count()).select_from(Customer)),
        "categories": [c for (c,) in db.execute(
            select(Order.category).where(Order.category != "")
            .group_by(Order.category)
            .order_by(func.count().desc()))],
        "existing_segments": [
            s for (s,) in db.execute(
                select(Segment.name)
                .order_by(Segment.created_at.desc()).limit(10))],
    }
    result = ai_service.copilot_turn(
        [m.model_dump() for m in body.messages], context)

    if "plan" in result:
        rules = RuleGroup.model_validate(result["plan"]["rules"])
        sample = audience_customers(db, rules, limit=3)
        result["plan"]["preview"] = {
            "count": audience_count(db, rules),
            "sample": [{"name": c.name, "city": c.city} for c in sample],
        }
    return result


@router.get("/campaigns/{campaign_id}/summary")
def campaign_summary(campaign_id: str, db: Session = Depends(get_db)):
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(404, "campaign not found")
    stats = _stats(db, campaign)["stats"]
    stats["campaign_name"] = campaign.name
    stats["channel"] = campaign.channel
    return {"summary": ai_service.summarize_campaign(stats)}


# Cache recommendations by funnel state so the same numbers always give the
# same advice (consistency), while a still-changing live funnel recomputes.
# In-memory per process; a shared cache (Redis) at scale.
_reco_cache: dict = {}


@router.get("/campaigns/{campaign_id}/recommendations")
def campaign_recommendations(campaign_id: str, db: Session = Depends(get_db)):
    """Active analysis — headline + prioritised, actionable recommendations
    from the campaign's live funnel. Stable for a given funnel state."""
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(404, "campaign not found")
    stats = _stats(db, campaign)["stats"]
    stats["campaign_name"] = campaign.name
    stats["channel"] = campaign.channel
    key = (campaign_id, stats["total_messages"], stats["failed"],
           round(stats["attributed_revenue"], 2),
           tuple(sorted(stats["funnel"].items())))
    if key not in _reco_cache:
        _reco_cache[key] = ai_service.recommend_for_campaign(stats)
    return _reco_cache[key]
