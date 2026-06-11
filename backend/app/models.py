"""Data model.

Six tables:
  customers, orders          -> ingested brand data
  segments                   -> saved audience definitions (JSON rule DSL)
  campaigns                  -> a message sent to a segment over a channel
  messages                   -> one row per customer per campaign (the "communication")
  message_events             -> immutable log of every receipt callback we ingest

Design notes (these come up in interviews):
  * `messages.status` is a *projection* of message_events. Events are the
    source of truth and are append-only; status is the convenient read model.
  * `message_events.event_id` is UNIQUE -> duplicate callbacks from the
    channel are idempotent no-ops at the DB layer.
  * `messages.status_rank` lets us apply events that arrive out of order:
    a status only ever moves forward (see services/receipt_processor.py).
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (JSON, DateTime, Float, ForeignKey, Index, Integer,
                        String, Text)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def uid() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(32), default="")
    city: Mapped[str] = mapped_column(String(80), default="", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    orders: Mapped[list["Order"]] = relationship(back_populates="customer")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id"), index=True)
    amount: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Attribution: set when this order resulted from a campaign message
    # (the channel simulator emits `converted` events).
    campaign_id: Mapped[str | None] = mapped_column(
        ForeignKey("campaigns.id"), nullable=True, index=True)

    customer: Mapped["Customer"] = relationship(back_populates="orders")


class Segment(Base):
    __tablename__ = "segments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    rules: Mapped[dict] = mapped_column(JSON)  # see services/segment_engine.py
    created_by: Mapped[str] = mapped_column(String(16), default="user")  # user|ai
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(160))
    segment_id: Mapped[str] = mapped_column(ForeignKey("segments.id"))
    # Snapshot of the rules at launch time, so editing the segment later
    # doesn't rewrite history.
    rules_snapshot: Mapped[dict] = mapped_column(JSON)
    channel: Mapped[str] = mapped_column(String(16))  # whatsapp|sms|email
    message_template: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    # draft -> dispatching -> dispatched (terminal for our scope)
    audience_size: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Message(Base):
    """One outbound communication to one customer."""
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id"), index=True)
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id"), index=True)
    channel: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    status_rank: Mapped[int] = mapped_column(Integer, default=0)
    failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("ix_messages_campaign_status",
                            "campaign_id", "status"),)


class MessageEvent(Base):
    """Append-only ledger of receipt callbacks. Source of truth."""
    __tablename__ = "message_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    # The channel's own event id. UNIQUE constraint = idempotency.
    event_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(16))
    occurred_at: Mapped[datetime] = mapped_column(DateTime)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
