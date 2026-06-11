from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Campaign, Message, Order, Segment
from ..schemas import CampaignCreate, RuleGroup
from ..services.dispatcher import dispatch_campaign
from ..services.receipt_processor import STATUS_RANK
from ..services.segment_engine import audience_count

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])

# Funnel stages in order. A message at rank >= stage rank has passed through
# that stage (statuses only move forward), so funnel counts come straight
# from the status_rank projection — no event-table scans needed per request.
FUNNEL_STAGES = ["sent", "delivered", "opened", "read", "clicked", "converted"]


@router.post("", status_code=201)
def create_campaign(body: CampaignCreate, db: Session = Depends(get_db)):
    segment = db.get(Segment, body.segment_id)
    if segment is None:
        raise HTTPException(404, "segment not found")
    rules = RuleGroup.model_validate(segment.rules)
    campaign = Campaign(
        name=body.name,
        segment_id=segment.id,
        rules_snapshot=rules.model_dump(),
        channel=body.channel,
        message_template=body.message_template,
        audience_size=audience_count(db, rules),
    )
    db.add(campaign)
    db.commit()
    return {"id": campaign.id, "audience_size": campaign.audience_size}


@router.post("/{campaign_id}/launch")
def launch(campaign_id: str, background: BackgroundTasks,
           db: Session = Depends(get_db)):
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(404, "campaign not found")
    if campaign.status != "draft":
        raise HTTPException(409, f"campaign already {campaign.status}")
    background.add_task(dispatch_campaign, campaign_id)
    return {"status": "dispatching"}


@router.get("")
def list_campaigns(db: Session = Depends(get_db)):
    campaigns = db.execute(
        select(Campaign).order_by(Campaign.created_at.desc())).scalars().all()
    return {"campaigns": [_stats(db, c) for c in campaigns]}


@router.get("/{campaign_id}")
def get_campaign(campaign_id: str, db: Session = Depends(get_db)):
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(404, "campaign not found")
    return _stats(db, campaign, include_messages=True)


def _stats(db: Session, c: Campaign, include_messages: bool = False) -> dict:
    by_status = dict(db.execute(
        select(Message.status, func.count())
        .where(Message.campaign_id == c.id)
        .group_by(Message.status)
    ).all())
    total = sum(by_status.values())
    failed = by_status.get("failed", 0)

    funnel = {
        stage: db.scalar(
            select(func.count()).select_from(Message)
            .where(Message.campaign_id == c.id,
                   Message.status != "failed",
                   Message.status_rank >= STATUS_RANK[stage]))
        for stage in FUNNEL_STAGES
    }
    attributed_revenue = db.scalar(
        select(func.coalesce(func.sum(Order.amount), 0.0))
        .where(Order.campaign_id == c.id))

    delivered = funnel["delivered"]
    out = {
        "id": c.id, "name": c.name, "channel": c.channel,
        "status": c.status, "audience_size": c.audience_size,
        "message_template": c.message_template,
        "rules_snapshot": c.rules_snapshot,
        "created_at": c.created_at, "started_at": c.started_at,
        "stats": {
            "total_messages": total,
            "by_status": by_status,
            "funnel": funnel,
            "failed": failed,
            "delivery_rate": round(delivered / total, 4) if total else 0,
            "open_rate": round(funnel["opened"] / delivered, 4) if delivered else 0,
            "click_rate": round(funnel["clicked"] / delivered, 4) if delivered else 0,
            "attributed_revenue": round(attributed_revenue, 2),
        },
    }
    if include_messages:
        rows = db.execute(
            select(Message).where(Message.campaign_id == c.id)
            .order_by(Message.updated_at.desc()).limit(50)
        ).scalars().all()
        out["recent_messages"] = [
            {"id": m.id, "customer_id": m.customer_id, "status": m.status,
             "content": m.content, "failure_reason": m.failure_reason,
             "updated_at": m.updated_at}
            for m in rows
        ]
    return out
