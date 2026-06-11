from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..routers.campaigns import _stats
from ..models import Campaign
from ..schemas import AIDraftRequest, AISegmentRequest, RuleGroup
from ..services import ai_service
from ..services.segment_engine import audience_count, audience_customers

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/status")
def status():
    """Lets the frontend degrade gracefully when no API key is configured."""
    return {"enabled": bool(settings.anthropic_api_key),
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


@router.get("/campaigns/{campaign_id}/summary")
def campaign_summary(campaign_id: str, db: Session = Depends(get_db)):
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(404, "campaign not found")
    stats = _stats(db, campaign)["stats"]
    stats["campaign_name"] = campaign.name
    stats["channel"] = campaign.channel
    return {"summary": ai_service.summarize_campaign(stats)}
