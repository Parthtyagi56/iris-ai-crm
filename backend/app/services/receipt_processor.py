"""Receipt processing: the heart of the callback loop.

Three real-world problems this handles, and how:

1. DUPLICATES — channels retry callbacks; the same event can arrive twice.
   -> `message_events.event_id` is UNIQUE. We check-then-insert and also
      catch IntegrityError, so duplicates are acknowledged (200) but no-op.

2. OUT-OF-ORDER ARRIVAL — an `opened` callback can beat `delivered` over the
   network. -> Statuses have a monotonic rank; a message's status only ever
   moves FORWARD. The late `delivered` is still recorded in the event ledger
   (analytics stays correct) but doesn't regress the projected status.

3. TERMINAL STATES — once `failed`, a message stays failed; stray engagement
   events for it are logged but ignored for status.

At scale this endpoint would sit behind a queue (SQS/Kafka) with consumer
workers; for this scope, synchronous batch processing with the same
idempotency guarantees demonstrates the design.
"""
import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Message, MessageEvent, Order
from ..schemas import ReceiptEvent

logger = logging.getLogger(__name__)

STATUS_RANK = {
    "queued": 0,
    "sent": 1,
    "delivered": 2,
    "opened": 3,
    "read": 4,
    "clicked": 5,
    "converted": 6,
    "failed": 7,  # terminal; rank only used so it can overwrite sent/queued
}
TERMINAL = {"failed", "converted"}


def process_event(db: Session, evt: ReceiptEvent) -> str:
    """Apply one receipt event. Returns a result tag for observability."""
    # Idempotency check (fast path).
    if db.query(MessageEvent.id).filter_by(event_id=evt.event_id).first():
        return "duplicate"

    msg: Message | None = db.get(Message, evt.message_id)
    if msg is None:
        # At scale: park on a DLQ / retry later (send and receipt can race).
        logger.warning("receipt for unknown message %s", evt.message_id)
        return "unknown_message"

    db.add(MessageEvent(
        event_id=evt.event_id,
        message_id=evt.message_id,
        event_type=evt.event_type,
        occurred_at=evt.occurred_at.replace(tzinfo=None),
        meta=evt.meta,
    ))
    try:
        db.flush()  # surfaces UNIQUE violation if two requests raced
    except IntegrityError:
        db.rollback()
        return "duplicate"

    applied = "recorded"
    new_rank = STATUS_RANK[evt.event_type]
    if msg.status not in TERMINAL and new_rank > msg.status_rank:
        msg.status = evt.event_type
        msg.status_rank = new_rank
        if evt.event_type == "failed":
            msg.failure_reason = str(evt.meta.get("reason", "unknown"))
        applied = "applied"

    # Closed-loop attribution: a conversion creates an order tied to the
    # campaign, so "revenue attributed" on the insights page is real data.
    if evt.event_type == "converted":
        db.add(Order(
            customer_id=msg.customer_id,
            amount=float(evt.meta.get("order_amount", 0.0)),
            campaign_id=msg.campaign_id,
        ))

    db.commit()
    return applied


def process_batch(db: Session, events: list[ReceiptEvent]) -> dict:
    results: dict[str, int] = {}
    for evt in events:
        tag = process_event(db, evt)
        results[tag] = results.get(tag, 0) + 1
    return results
