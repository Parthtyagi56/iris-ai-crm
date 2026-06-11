"""AI layer: natural language -> structured campaign artifacts.

Pattern used throughout: we force the model to "call a tool" whose
input_schema mirrors our Pydantic schemas, then validate the result with
Pydantic before it touches the rest of the system. The model proposes;
deterministic code disposes. If the model emits an invalid rule, validation
fails loudly instead of corrupting a campaign.
"""
from datetime import datetime

import anthropic
from fastapi import HTTPException

from ..config import settings
from ..schemas import RuleGroup

_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=503,
            detail="AI features need ANTHROPIC_API_KEY to be set.")
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


SEGMENT_TOOL = {
    "name": "create_segment",
    "description": "Create an audience segment from the marketer's description.",
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Short segment name."},
            "explanation": {
                "type": "string",
                "description": "One sentence, plain-language: who this targets and why these rules.",
            },
            "rules": {
                "type": "object",
                "properties": {
                    "op": {"type": "string", "enum": ["and", "or"]},
                    "conditions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "field": {
                                    "type": "string",
                                    "enum": [
                                        "total_spend", "order_count",
                                        "avg_order_value",
                                        "days_since_last_order",
                                        "days_since_joined", "city",
                                    ],
                                },
                                "cmp": {
                                    "type": "string",
                                    "enum": [">", ">=", "<", "<=", "==", "!=", "in"],
                                },
                                "value": {},
                            },
                            "required": ["field", "cmp", "value"],
                        },
                    },
                },
                "required": ["op", "conditions"],
            },
        },
        "required": ["name", "explanation", "rules"],
    },
}

DRAFT_TOOL = {
    "name": "draft_messages",
    "description": "Draft message variants for a marketing campaign.",
    "input_schema": {
        "type": "object",
        "properties": {
            "variants": {
                "type": "array",
                "minItems": 2,
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string",
                                  "description": "2-3 word angle, e.g. 'Warm win-back'"},
                        "content": {"type": "string"},
                    },
                    "required": ["label", "content"],
                },
            }
        },
        "required": ["variants"],
    },
}


def _forced_tool_call(system: str, user: str, tool: dict) -> dict:
    resp = client().messages.create(
        model=settings.ai_model,
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": user}],
        tools=[tool],
        tool_choice={"type": "tool", "name": tool["name"]},
    )
    for block in resp.content:
        if block.type == "tool_use":
            return block.input
    raise HTTPException(status_code=502, detail="AI returned no structured output.")


def segment_from_text(prompt: str) -> dict:
    system = (
        "You translate a marketer's audience description into segment rules "
        "for a consumer-brand CRM (currency context: INR). "
        f"Today is {datetime.utcnow():%Y-%m-%d}. Available fields: total_spend "
        "(lifetime, INR), order_count, avg_order_value (INR), "
        "days_since_last_order, days_since_joined, city. Keep rules minimal — "
        "only what the marketer actually asked for. 'Lapsed' or 'inactive' "
        "usually means days_since_last_order > 60 unless they specify. "
        "'High spenders' usually means total_spend >= 5000 unless they specify."
    )
    raw = _forced_tool_call(system, prompt, SEGMENT_TOOL)
    # Validate before anything downstream trusts it.
    rules = RuleGroup.model_validate(raw["rules"])
    return {"name": raw["name"], "explanation": raw["explanation"],
            "rules": rules.model_dump()}


def draft_messages(objective: str, audience_description: str, channel: str) -> dict:
    limits = {
        "sms": "Max 160 characters. No emojis overload, one clear CTA.",
        "whatsapp": "Max ~500 characters, conversational, 1-2 emojis fine, one CTA.",
        "email": "Subject-line style first sentence, then 2-3 short sentences, one CTA.",
    }
    system = (
        "You write high-converting retention marketing copy for an Indian "
        "consumer brand. Personalisation tokens available (use at least "
        "{{first_name}}): {{first_name}}, {{name}}, {{city}}. "
        f"Channel: {channel}. Constraint: {limits[channel]} "
        "Each variant must take a genuinely different angle."
    )
    user = (f"Objective: {objective}\n"
            f"Audience: {audience_description or 'see objective'}")
    return _forced_tool_call(system, user, DRAFT_TOOL)


def summarize_campaign(stats: dict) -> str:
    system = (
        "You are a marketing analyst. Given campaign delivery and engagement "
        "stats as JSON, write a crisp 2-3 sentence performance summary for a "
        "brand marketer: lead with the headline number, flag anything "
        "unusual (e.g. high failure rate), and end with one concrete "
        "suggestion. No preamble, no bullet points."
    )
    resp = client().messages.create(
        model=settings.ai_model,
        max_tokens=300,
        system=system,
        messages=[{"role": "user", "content": str(stats)}],
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()
