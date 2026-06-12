"""AI layer: natural language -> structured campaign artifacts.

Provider-agnostic by design. Two interchangeable backends:

  * Anthropic — the model is forced into a tool call whose input_schema
    mirrors our Pydantic schemas.
  * Any OpenAI-compatible endpoint (free tiers: Groq, Google Gemini,
    OpenRouter, local Ollama) — JSON mode + the same schema embedded in the
    system prompt.

Either way the output is validated with Pydantic BEFORE anything downstream
trusts it. The model proposes; deterministic code disposes. If the model
emits an invalid artifact, validation fails loudly instead of corrupting a
campaign.
"""
import json
import logging
from datetime import datetime

import httpx
from fastapi import HTTPException
from pydantic import ValidationError

from ..config import settings
from ..schemas import RuleGroup

logger = logging.getLogger(__name__)

CHANNELS = ["whatsapp", "sms", "email", "rcs"]
CHANNEL_CONSTRAINTS = {
    "sms": "Max 160 characters. No emoji overload, one clear CTA.",
    "whatsapp": "Max ~500 characters, conversational, 1-2 emojis fine, one CTA.",
    "email": "Subject-line style first sentence, then 2-3 short sentences, one CTA.",
    "rcs": "Rich-card style: punchy first line as the card title, then 1-2 short sentences, one CTA button text in [brackets].",
}

RULES_SCHEMA = {
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
                        "enum": ["total_spend", "order_count",
                                 "avg_order_value", "days_since_last_order",
                                 "days_since_joined", "city"],
                    },
                    "cmp": {"type": "string",
                            "enum": [">", ">=", "<", "<=", "==", "!=", "in"]},
                    "value": {},
                },
                "required": ["field", "cmp", "value"],
            },
        },
    },
    "required": ["op", "conditions"],
}


def _require_ai() -> str:
    provider = settings.ai_provider
    if not provider:
        raise HTTPException(
            status_code=503,
            detail="AI features need ANTHROPIC_API_KEY, or AI_API_KEY + "
                   "AI_BASE_URL for a free OpenAI-compatible provider "
                   "(Groq, Gemini, OpenRouter, Ollama).")
    return provider


# ---------------------------------------------------------------- providers

def _anthropic_structured(system: str, user: str, tool: dict) -> dict:
    import anthropic
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    resp = client.messages.create(
        model=settings.ai_model,
        max_tokens=1500,
        system=system,
        messages=[{"role": "user", "content": user}],
        tools=[tool],
        tool_choice={"type": "tool", "name": tool["name"]},
    )
    for block in resp.content:
        if block.type == "tool_use":
            return block.input
    raise HTTPException(502, "AI returned no structured output.")


def _extract_json(text: str) -> dict:
    """Tolerate code fences and prose around the JSON object."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise HTTPException(502, "AI response contained no JSON object.")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise HTTPException(502, f"AI returned malformed JSON: {exc}")


def _openai_structured(system: str, user: str, tool: dict) -> dict:
    """JSON mode against any OpenAI-compatible /chat/completions."""
    schema_prompt = (
        f"{system}\n\nRespond with ONLY a JSON object matching this schema "
        f"(no prose, no code fences):\n"
        f"{json.dumps(tool['input_schema'], indent=1)}"
    )
    body = {
        "model": settings.ai_model,
        "messages": [{"role": "system", "content": schema_prompt},
                     {"role": "user", "content": user}],
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {settings.ai_api_key}"}
    url = settings.ai_base_url.rstrip("/") + "/chat/completions"
    try:
        resp = httpx.post(url, json=body, headers=headers, timeout=60)
        if resp.status_code == 400 and "response_format" in resp.text:
            # Some providers reject json mode; the schema prompt still works.
            body.pop("response_format")
            resp = httpx.post(url, json=body, headers=headers, timeout=60)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error("AI provider error: %s", exc.response.text[:500])
        raise HTTPException(502, f"AI provider returned {exc.response.status_code}. "
                                 "Check AI_BASE_URL, AI_MODEL and your key.")
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Could not reach AI provider: {exc}")
    content = resp.json()["choices"][0]["message"]["content"]
    return _extract_json(content)


def _structured(system: str, user: str, tool: dict) -> dict:
    provider = _require_ai()
    if provider == "anthropic":
        return _anthropic_structured(system, user, tool)
    return _openai_structured(system, user, tool)


# ------------------------------------------------------------- touchpoints

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
            "rules": RULES_SCHEMA,
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


def _segment_system() -> str:
    return (
        "You translate a marketer's audience description into segment rules "
        "for a consumer-brand CRM (currency context: INR). "
        f"Today is {datetime.utcnow():%Y-%m-%d}. Available fields: total_spend "
        "(lifetime, INR), order_count, avg_order_value (INR), "
        "days_since_last_order, days_since_joined, city. Keep rules minimal — "
        "only what the marketer actually asked for. 'Lapsed' or 'inactive' "
        "usually means days_since_last_order > 60 unless they specify. "
        "'High spenders' usually means total_spend >= 5000 unless they specify."
    )


def segment_from_text(prompt: str) -> dict:
    raw = _structured(_segment_system(), prompt, SEGMENT_TOOL)
    # Validate before anything downstream trusts it.
    rules = RuleGroup.model_validate(raw["rules"])
    return {"name": raw.get("name", "New audience"),
            "explanation": raw.get("explanation", ""),
            "rules": rules.model_dump()}


def draft_messages(objective: str, audience_description: str, channel: str) -> dict:
    system = (
        "You write high-converting retention marketing copy for an Indian "
        "consumer brand. Personalisation tokens available (use at least "
        "{{first_name}}): {{first_name}}, {{name}}, {{city}}. "
        f"Channel: {channel}. Constraint: {CHANNEL_CONSTRAINTS[channel]} "
        "Each variant must take a genuinely different angle."
    )
    user = (f"Objective: {objective}\n"
            f"Audience: {audience_description or 'see objective'}")
    out = _structured(system, user, DRAFT_TOOL)
    if not out.get("variants"):
        raise HTTPException(502, "AI returned no variants.")
    return {"variants": out["variants"][:3]}


def summarize_campaign(stats: dict) -> str:
    system = (
        "You are a marketing analyst. Given campaign delivery and engagement "
        "stats as JSON, write a crisp 2-3 sentence performance summary for a "
        "brand marketer: lead with the headline number, flag anything "
        "unusual (e.g. high failure rate), and end with one concrete "
        "suggestion. No preamble, no bullet points."
    )
    provider = _require_ai()
    if provider == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        resp = client.messages.create(
            model=settings.ai_model, max_tokens=300, system=system,
            messages=[{"role": "user", "content": str(stats)}])
        return "".join(b.text for b in resp.content if b.type == "text").strip()
    # OpenAI-compatible: reuse the structured helper with a trivial schema.
    out = _openai_structured(
        system + " Return {\"summary\": \"...\"}.",
        json.dumps(stats),
        {"input_schema": {"type": "object",
                          "properties": {"summary": {"type": "string"}},
                          "required": ["summary"]}})
    return str(out.get("summary", "")).strip()


# ------------------------------------------------------------------ copilot

COPILOT_TOOL = {
    "name": "copilot_turn",
    "description": "Respond to the marketer and, when ready, propose a complete campaign plan.",
    "input_schema": {
        "type": "object",
        "properties": {
            "reply": {
                "type": "string",
                "description": "Short conversational reply shown in the chat. Ask at most one clarifying question at a time.",
            },
            "plan": {
                "type": "object",
                "description": "Include ONLY when you have enough to propose the full campaign.",
                "properties": {
                    "campaign_name": {"type": "string"},
                    "segment_name": {"type": "string"},
                    "rules": RULES_SCHEMA,
                    "channel": {"type": "string", "enum": CHANNELS},
                    "channel_reason": {"type": "string",
                                       "description": "One short sentence on why this channel."},
                    "variants": {
                        "type": "array", "minItems": 1, "maxItems": 3,
                        "items": {
                            "type": "object",
                            "properties": {"label": {"type": "string"},
                                           "content": {"type": "string"}},
                            "required": ["label", "content"],
                        },
                    },
                },
                "required": ["campaign_name", "segment_name", "rules",
                             "channel", "variants"],
            },
        },
        "required": ["reply"],
    },
}


def copilot_turn(messages: list[dict], context: dict) -> dict:
    """One conversational turn. Returns {reply, plan?} with plan validated.

    The copilot never executes anything — it proposes a plan the UI renders
    as an editable artifact, and existing (human-approved) endpoints do the
    actual creating and sending.
    """
    system = (
        "You are the campaign copilot inside Aurelia, a marketing CRM for an "
        "Indian D2C fashion brand. You help the marketer go from a goal to a "
        "ready-to-approve campaign: audience rules, channel choice, and "
        "message copy. You NEVER send anything — the marketer reviews and "
        "approves your plan in the UI.\n\n"
        f"Today: {datetime.utcnow():%Y-%m-%d}.\n"
        f"Brand context: {json.dumps(context)}\n\n"
        + _segment_system() + "\n\n"
        "Channels and copy constraints:\n"
        + "\n".join(f"- {c}: {CHANNEL_CONSTRAINTS[c]}" for c in CHANNELS) +
        "\n\nPersonalisation tokens (use at least {{first_name}}): "
        "{{first_name}}, {{name}}, {{city}}.\n"
        "Conversation policy: if the goal is clear enough, propose the full "
        "plan immediately — don't interrogate. If something essential is "
        "missing, ask ONE question. When the marketer asks for changes, "
        "return the AMENDED full plan."
    )
    transcript = "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in messages)

    raw = _structured(system, transcript, COPILOT_TOOL)
    result: dict = {"reply": str(raw.get("reply", "")).strip() or "Here's my proposal."}

    plan = raw.get("plan")
    if plan:
        try:
            rules = RuleGroup.model_validate(plan["rules"])
            channel = plan["channel"]
            if channel not in CHANNELS:
                raise ValueError(f"unknown channel {channel}")
            variants = [
                {"label": str(v["label"]), "content": str(v["content"])}
                for v in plan["variants"][:3] if v.get("content")
            ]
            if not variants:
                raise ValueError("no usable variants")
            result["plan"] = {
                "campaign_name": str(plan["campaign_name"]),
                "segment_name": str(plan["segment_name"]),
                "rules": rules.model_dump(),
                "channel": channel,
                "channel_reason": str(plan.get("channel_reason", "")),
                "variants": variants,
            }
        except (ValidationError, KeyError, ValueError, TypeError) as exc:
            # The artifact failed validation: surface that honestly instead
            # of letting a broken plan reach the approve button.
            logger.warning("copilot plan failed validation: %s", exc)
            result["reply"] += (
                "\n\n(I drafted a plan but part of it didn't validate — "
                "could you rephrase or add a detail?)")
    return result
