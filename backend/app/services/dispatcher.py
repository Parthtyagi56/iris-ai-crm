"""Campaign dispatch: CRM -> channel service.

Flow:
  1. Materialise the audience from the campaign's rules snapshot.
  2. Create one `messages` row per recipient (status=queued) — this is our
     durable record of intent, created BEFORE any network call.
  3. POST to the channel service in batches, with bounded retries and
     exponential backoff. The channel returns 202 (accepted), and real
     outcomes arrive later via the receipts webhook.
  4. Mark each batch `sent` on acceptance, or `failed` if the channel is
     unreachable after retries.

Scale note (worth saying in the video): at real volume this loop becomes a
producer pushing message ids onto a queue with worker consumers, so dispatch
is horizontally scalable and survives process restarts. The per-message
`queued` row + idempotent receipt ingestion means the design migrates to
that architecture without schema changes.
"""
import logging
import time

import httpx

from ..config import settings
from ..database import SessionLocal
from ..models import Campaign, Customer, Message, utcnow
from ..schemas import RuleGroup
from .receipt_processor import STATUS_RANK
from .segment_engine import audience_customers

logger = logging.getLogger(__name__)

MAX_RETRIES = 3


def personalize(template: str, customer: Customer) -> str:
    first_name = (customer.name or "there").split(" ")[0]
    return (
        template
        .replace("{{first_name}}", first_name)
        .replace("{{name}}", customer.name or "there")
        .replace("{{city}}", customer.city or "your city")
    )


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _post_batch_with_retry(payload: dict) -> bool:
    url = f"{settings.channel_service_url}/send"
    for attempt in range(MAX_RETRIES):
        try:
            resp = httpx.post(url, json=payload, timeout=15)
            resp.raise_for_status()
            return True
        except httpx.HTTPError as exc:
            wait = 2 ** attempt
            logger.warning("channel send failed (attempt %s): %s; retrying in %ss",
                           attempt + 1, exc, wait)
            time.sleep(wait)
    return False


def dispatch_campaign(campaign_id: str) -> None:
    """Runs in a background task; opens its own DB session."""
    db = SessionLocal()
    try:
        campaign = db.get(Campaign, campaign_id)
        if campaign is None or campaign.status != "draft":
            return
        campaign.status = "dispatching"
        campaign.started_at = utcnow()
        db.commit()

        rules = RuleGroup.model_validate(campaign.rules_snapshot)
        audience = audience_customers(db, rules)
        campaign.audience_size = len(audience)

        messages = [
            Message(
                campaign_id=campaign.id,
                customer_id=c.id,
                channel=campaign.channel,
                content=personalize(campaign.message_template, c),
            )
            for c in audience
        ]
        db.add_all(messages)
        db.commit()

        callback_url = f"{settings.crm_public_url}/api/receipts"
        customers_by_id = {c.id: c for c in audience}

        for batch in _chunks(messages, settings.send_batch_size):
            payload = {
                "callback_url": callback_url,
                "messages": [
                    {
                        "message_id": m.id,
                        "channel": m.channel,
                        "content": m.content,
                        "recipient": {
                            "name": customers_by_id[m.customer_id].name,
                            "email": customers_by_id[m.customer_id].email,
                            "phone": customers_by_id[m.customer_id].phone,
                        },
                    }
                    for m in batch
                ],
            }
            ok = _post_batch_with_retry(payload)
            new_status = "sent" if ok else "failed"
            for m in batch:
                m.status = new_status
                m.status_rank = STATUS_RANK[new_status]
                if not ok:
                    m.failure_reason = "channel_unreachable"
            db.commit()

        campaign.status = "dispatched"
        db.commit()
        logger.info("campaign %s dispatched to %s recipients",
                    campaign.id, campaign.audience_size)
    finally:
        db.close()
