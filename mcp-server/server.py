"""Aurelia CRM — MCP server.

Exposes the CRM as a set of Model Context Protocol tools so an AI agent
(Claude Desktop, or any MCP client) can run the full marketing loop by
conversation: explore the base, build an audience, draft copy, create and
launch a campaign, then read back the delivery/engagement funnel.

Like the channel service, this is a *separate* process with no shared code
with the CRM — it speaks only HTTP to the same public REST API a human UI
uses. Launching a campaign here triggers the real send → channel-simulator →
receipt → stats loop; nothing is special-cased for the agent.

Run standalone:   python server.py        (stdio transport)
Point a client at it via claude_desktop_config.json — see README.md.
"""
import os

import httpx
from mcp.server.fastmcp import FastMCP

CRM = os.environ.get("CRM_BASE_URL", "http://localhost:8000").rstrip("/")
TOKEN = os.environ.get("CRM_TOKEN", "")  # only needed for profile endpoints

mcp = FastMCP("aurelia-crm")


def _headers() -> dict:
    return {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}


def _get(path: str, **params):
    r = httpx.get(f"{CRM}{path}", params=params, headers=_headers(), timeout=60)
    r.raise_for_status()
    return r.json()


def _post(path: str, body: dict | None = None):
    r = httpx.post(f"{CRM}{path}", json=body or {}, headers=_headers(), timeout=90)
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------- read tools

@mcp.tool()
def get_dashboard() -> dict:
    """Workspace snapshot: customer/order/revenue totals, customer-health
    buckets (active/cooling/lapsed), 12-week revenue trend, category demand
    with repeat rates, and the best campaign per category. Start here to
    understand the brand before proposing anything."""
    return _get("/api/dashboard")


@mcp.tool()
def list_customers(query: str = "", limit: int = 10) -> dict:
    """Search customers by name or email. Returns spend, order count, last
    order date and most-bought category per customer."""
    return _get("/api/customers", q=query, limit=limit)


@mcp.tool()
def list_audiences() -> dict:
    """List saved audience segments (name, rules, who created them)."""
    return _get("/api/segments")


@mcp.tool()
def preview_audience(rules: dict) -> dict:
    """Count and sample the customers an audience rule matches BEFORE saving.
    `rules` is the segment DSL, e.g.
    {"op":"and","conditions":[{"field":"total_spend","cmp":">=","value":15000}]}.
    Fields: total_spend, order_count, avg_order_value, days_since_last_order,
    days_since_joined, city. Comparators: > >= < <= == != in."""
    return _post("/api/segments/preview", {"rules": rules})


@mcp.tool()
def list_campaigns() -> dict:
    """All campaigns with their live funnel stats (sent/delivered/opened/
    clicked/converted), delivery rate and attributed revenue."""
    return _get("/api/campaigns")


@mcp.tool()
def get_campaign(campaign_id: str) -> dict:
    """Full detail for one campaign: the funnel projection updated by the
    receipt callbacks, the targeting rules snapshot, and recent messages."""
    return _get(f"/api/campaigns/{campaign_id}")


# ------------------------------------------------------------ AI-assist tools

@mcp.tool()
def ai_build_audience(prompt: str) -> dict:
    """Turn a plain-language audience description into validated segment
    rules plus a live audience preview, in one call. e.g. "high spenders in
    Mumbai who haven't ordered in 60 days"."""
    return _post("/api/ai/segment", {"prompt": prompt})


@mcp.tool()
def ai_draft_messages(objective: str, channel: str = "whatsapp",
                      audience_description: str = "") -> dict:
    """Draft 2-3 channel-appropriate message variants with personalisation
    tokens ({{first_name}}, {{name}}, {{city}}). channel: whatsapp|sms|email|rcs."""
    return _post("/api/ai/draft", {"objective": objective, "channel": channel,
                                   "audience_description": audience_description})


@mcp.tool()
def ai_campaign_summary(campaign_id: str) -> dict:
    """An analyst-style 2-3 sentence performance narrative for a campaign."""
    return _get(f"/api/ai/campaigns/{campaign_id}/summary")


# -------------------------------------------------------------- action tools

@mcp.tool()
def create_audience(name: str, rules: dict, description: str = "") -> dict:
    """Save an audience segment. `rules` uses the segment DSL (see
    preview_audience). Returns the new segment id and its audience count.
    Preview first so you know who it reaches."""
    return _post("/api/segments", {"name": name, "rules": rules,
                                   "description": description, "created_by": "ai"})


@mcp.tool()
def create_campaign(name: str, segment_id: str, channel: str,
                    message_template: str) -> dict:
    """Create a DRAFT campaign for a saved segment. channel:
    whatsapp|sms|email|rcs. The template may use {{first_name}}, {{name}},
    {{city}} — personalised per recipient at send time. Does NOT send until
    launch_campaign is called."""
    return _post("/api/campaigns", {"name": name, "segment_id": segment_id,
                                    "channel": channel,
                                    "message_template": message_template})


@mcp.tool()
def launch_campaign(campaign_id: str) -> dict:
    """Launch a draft campaign. This materialises the audience, writes one
    queued message per recipient, and dispatches to the channel service —
    which asynchronously calls back delivery/engagement receipts that update
    the funnel. This actually 'sends' (to the simulator); confirm with the
    marketer before calling it."""
    return _post(f"/api/campaigns/{campaign_id}/launch")


if __name__ == "__main__":
    mcp.run()
