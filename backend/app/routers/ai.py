from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..routers.campaigns import _stats
from ..models import Campaign, Customer, Order, Segment
from ..schemas import (AIChatRequest, AIDraftRequest, AISegmentRequest,
                       RuleGroup)
from ..services import ai_service
from ..services.segment_engine import audience_count, audience_customers

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/status")
def status():
    """Lets the frontend degrade gracefully when no API key is configured."""
    return {"enabled": bool(settings.ai_provider),
            "provider": settings.ai_provider,
            "model": settings.ai_model}


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
