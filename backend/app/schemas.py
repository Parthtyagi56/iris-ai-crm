"""Pydantic schemas, including the segment rule DSL.

The DSL is deliberately small and JSON-serialisable:

    {"op": "and", "conditions": [
        {"field": "total_spend", "cmp": ">=", "value": 5000},
        {"field": "days_since_last_order", "cmp": ">", "value": 60},
        {"op": "or", "conditions": [...]}            # groups can nest
    ]}

Why a DSL instead of letting the AI write SQL? Three reasons we can defend:
  1. Safety   - the AI can never produce arbitrary SQL; only whitelisted
                fields/operators compile.
  2. UX       - rules are structured data, so the UI can render them as
                editable chips and show a live audience preview.
  3. Auditability - campaigns snapshot the rules JSON, not an opaque query.
"""
from datetime import datetime
from typing import Literal, Union

from pydantic import BaseModel, Field

SegmentField = Literal[
    "total_spend",
    "order_count",
    "avg_order_value",
    "days_since_last_order",
    "days_since_joined",
    "city",
]
Comparator = Literal[">", ">=", "<", "<=", "==", "!=", "in"]
Channel = Literal["whatsapp", "sms", "email", "rcs"]


class Condition(BaseModel):
    field: SegmentField
    cmp: Comparator
    value: Union[float, int, str, list[str]]


class RuleGroup(BaseModel):
    op: Literal["and", "or"]
    conditions: list[Union[Condition, "RuleGroup"]] = Field(min_length=1)


RuleGroup.model_rebuild()


# ---------- customers / orders ----------

class CustomerIn(BaseModel):
    name: str
    email: str
    phone: str = ""
    city: str = ""


class CustomerOut(CustomerIn):
    id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class OrderIn(BaseModel):
    customer_email: str
    amount: float
    created_at: datetime | None = None


# ---------- segments ----------

class SegmentCreate(BaseModel):
    name: str
    description: str = ""
    rules: RuleGroup
    created_by: Literal["user", "ai"] = "user"


class SegmentPreviewRequest(BaseModel):
    rules: RuleGroup


# ---------- campaigns ----------

class CampaignCreate(BaseModel):
    name: str
    segment_id: str
    channel: Channel
    message_template: str


# ---------- receipts (channel -> CRM callbacks) ----------

class ReceiptEvent(BaseModel):
    event_id: str
    message_id: str
    event_type: Literal[
        "sent", "delivered", "failed", "opened", "read", "clicked", "converted"
    ]
    occurred_at: datetime
    meta: dict = {}


class ReceiptBatch(BaseModel):
    events: list[ReceiptEvent]


# ---------- AI ----------

class AISegmentRequest(BaseModel):
    prompt: str


class AIDraftRequest(BaseModel):
    objective: str
    audience_description: str = ""
    channel: Channel = "whatsapp"
