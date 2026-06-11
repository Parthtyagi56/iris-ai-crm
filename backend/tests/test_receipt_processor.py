"""Tests for the part of the system most likely to be probed in review:
idempotent, out-of-order-safe receipt ingestion."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Campaign, Customer, Message, MessageEvent, Order, Segment
from app.schemas import ReceiptEvent
from app.services.receipt_processor import process_event


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")  # in-memory
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture()
def message(db):
    customer = Customer(name="Asha Rao", email="asha@example.com")
    segment = Segment(name="s", rules={"op": "and", "conditions": [
        {"field": "order_count", "cmp": ">=", "value": 0}]})
    db.add_all([customer, segment])
    db.flush()
    campaign = Campaign(name="c", segment_id=segment.id,
                        rules_snapshot=segment.rules, channel="whatsapp",
                        message_template="hi")
    db.add(campaign)
    db.flush()
    msg = Message(campaign_id=campaign.id, customer_id=customer.id,
                  channel="whatsapp", content="hi", status="sent",
                  status_rank=1)
    db.add(msg)
    db.commit()
    return msg


def evt(message_id, event_type, event_id, offset_s=0, meta=None):
    return ReceiptEvent(
        event_id=event_id, message_id=message_id, event_type=event_type,
        occurred_at=datetime.now(timezone.utc) + timedelta(seconds=offset_s),
        meta=meta or {})


def test_out_of_order_events_never_regress_status(db, message):
    # `clicked` arrives BEFORE `delivered` (network reordering).
    assert process_event(db, evt(message.id, "clicked", "e1", 30)) == "applied"
    assert message.status == "clicked"

    # The late `delivered` is recorded but must not regress the status.
    assert process_event(db, evt(message.id, "delivered", "e2", 5)) == "recorded"
    assert message.status == "clicked"
    assert db.query(MessageEvent).count() == 2  # ledger keeps both


def test_duplicate_events_are_idempotent(db, message):
    assert process_event(db, evt(message.id, "delivered", "same-id")) == "applied"
    assert process_event(db, evt(message.id, "delivered", "same-id")) == "duplicate"
    assert db.query(MessageEvent).count() == 1


def test_failed_is_terminal(db, message):
    process_event(db, evt(message.id, "failed", "e1",
                          meta={"reason": "invalid_number"}))
    assert message.status == "failed"
    assert message.failure_reason == "invalid_number"

    # A stray engagement event afterwards must not resurrect the message.
    process_event(db, evt(message.id, "opened", "e2"))
    assert message.status == "failed"


def test_conversion_creates_attributed_order(db, message):
    process_event(db, evt(message.id, "converted", "e1",
                          meta={"order_amount": 2499.0}))
    order = db.query(Order).one()
    assert order.campaign_id == message.campaign_id
    assert order.amount == 2499.0


def test_unknown_message_is_acknowledged_not_crashed(db, message):
    assert process_event(db, evt("nope", "delivered", "e9")) == "unknown_message"
