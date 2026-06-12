"""Stubbed channel service (separate deployable, no shared code with the CRM).

Receives send requests, ACKs immediately with 202, then ASYNCHRONOUSLY
simulates what a real channel does to each message and reports outcomes to
the CRM's receipt webhook.

It deliberately misbehaves the way real channels do, so the CRM's receipt
ingestion has something real to be robust against:
  * ~8% of messages fail outright
  * engagement rates vary by channel (WhatsApp >> email > sms clicks)
  * callbacks arrive after random delays, and ~15% of the time the event
    ORDER is shuffled (an `opened` can land before its `delivered`)
  * ~10% of callbacks are sent twice (duplicate delivery)
  * callbacks are retried with exponential backoff if the CRM is down
  * every callback is HMAC-signed so the CRM can authenticate it

`occurred_at` timestamps always reflect the TRUE event order — arrival order
is what gets scrambled. The CRM must therefore not trust arrival order.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("channel")

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "dev-secret-change-me")

FAILURE_RATE = 0.08
DUPLICATE_RATE = 0.10
SHUFFLE_RATE = 0.15
MAX_CALLBACK_RETRIES = 4

# Per-channel engagement funnel probabilities (of the previous stage).
CHANNEL_PROFILES = {
    "whatsapp": {"opened": 0.65, "read": 0.85, "clicked": 0.30, "converted": 0.25},
    "email":    {"opened": 0.32, "read": 0.60, "clicked": 0.18, "converted": 0.20},
    "sms":      {"opened": 0.45, "read": 0.70, "clicked": 0.10, "converted": 0.15},
    "rcs":      {"opened": 0.55, "read": 0.80, "clicked": 0.25, "converted": 0.20},
}
FAILURE_REASONS = ["invalid_number", "blocked_by_recipient",
                   "carrier_rejected", "rate_limited"]

app = FastAPI(title="Channel Simulator")

# Bound concurrency so a 10k-message campaign doesn't spawn 10k sockets.
_semaphore = asyncio.Semaphore(50)


class Recipient(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""


class OutboundMessage(BaseModel):
    message_id: str
    channel: str
    content: str
    recipient: Recipient


class SendRequest(BaseModel):
    callback_url: str
    messages: list[OutboundMessage]


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/send", status_code=202)
async def send(req: SendRequest):
    """ACK fast, simulate later — exactly like a real provider."""
    for message in req.messages:
        asyncio.create_task(_simulate(message, req.callback_url))
    return {"accepted": len(req.messages)}


def _make_event(message_id: str, event_type: str,
                occurred_at: datetime, meta: dict | None = None) -> dict:
    return {
        "event_id": uuid.uuid4().hex,
        "message_id": message_id,
        "event_type": event_type,
        "occurred_at": occurred_at.isoformat(),
        "meta": meta or {},
    }


def _plan_lifecycle(message: OutboundMessage) -> list[dict]:
    """Decide upfront what 'really happened' to this message."""
    profile = CHANNEL_PROFILES.get(message.channel, CHANNEL_PROFILES["sms"])
    t = datetime.now(timezone.utc)
    events: list[dict] = []

    if random.random() < FAILURE_RATE:
        events.append(_make_event(
            message.message_id, "failed", t + timedelta(seconds=1),
            {"reason": random.choice(FAILURE_REASONS)}))
        return events

    t += timedelta(seconds=random.uniform(0.5, 3))
    events.append(_make_event(message.message_id, "delivered", t))

    for stage in ("opened", "read", "clicked", "converted"):
        if random.random() >= profile[stage]:
            break
        t += timedelta(seconds=random.uniform(2, 30))
        meta = ({"order_amount": round(random.uniform(800, 6000), 2)}
                if stage == "converted" else {})
        events.append(_make_event(message.message_id, stage, t, meta))
    return events


async def _simulate(message: OutboundMessage, callback_url: str) -> None:
    async with _semaphore:
        events = _plan_lifecycle(message)

        # Reality is in `occurred_at`; the wire is unreliable: sometimes
        # callbacks overtake each other.
        if len(events) > 1 and random.random() < SHUFFLE_RATE:
            random.shuffle(events)

        for event in events:
            await asyncio.sleep(random.uniform(0.2, 1.5))
            await _post_callback(callback_url, [event])
            if random.random() < DUPLICATE_RATE:
                await _post_callback(callback_url, [event])  # duplicate!


async def _post_callback(callback_url: str, events: list[dict]) -> None:
    body = json.dumps({"events": events}).encode()
    signature = hmac.new(WEBHOOK_SECRET.encode(), body,
                         hashlib.sha256).hexdigest()
    headers = {"Content-Type": "application/json",
               "X-Channel-Signature": signature}
    async with httpx.AsyncClient(timeout=10) as client:
        for attempt in range(MAX_CALLBACK_RETRIES):
            try:
                resp = await client.post(callback_url, content=body,
                                         headers=headers)
                if resp.status_code < 500:
                    return  # 2xx processed; 4xx won't improve with retries
            except httpx.HTTPError as exc:
                logger.warning("callback attempt %s failed: %s",
                               attempt + 1, exc)
            await asyncio.sleep(2 ** attempt + random.random())
        logger.error("callback permanently failed for events %s",
                     [e["event_id"] for e in events])
