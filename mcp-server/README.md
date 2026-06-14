# Iris CRM — MCP server

Makes the CRM **agent-operable**. Exposes the campaign loop as
[Model Context Protocol](https://modelcontextprotocol.io) tools, so Claude
(Desktop, or any MCP client) can run marketing end to end by conversation:

> *"Find my lapsed high spenders, draft a WhatsApp win-back, and launch it."*

Like the channel service, it shares **no code** with the CRM — it speaks only
HTTP to the same public REST API the web UI uses. A campaign launched through
an MCP tool goes through the identical send → channel-simulator → receipt →
stats loop.

## Tools

| Tool | What the agent can do |
|---|---|
| `get_dashboard` | Read the brand snapshot (health, category demand, best campaign per category) |
| `list_customers` | Search the customer base |
| `list_audiences` / `preview_audience` / `create_audience` | Inspect, test, and save segment rules |
| `ai_build_audience` | NL → validated rules + live preview |
| `ai_draft_messages` | Generate channel-appropriate, personalised copy |
| `list_campaigns` / `get_campaign` | Read live funnel stats |
| `create_campaign` | Create a **draft** (does not send) |
| `launch_campaign` | Dispatch — triggers the real receipt loop |
| `ai_campaign_summary` | Analyst-style performance narrative |

The split between `create_campaign` (draft) and `launch_campaign` (send) keeps
the human approval boundary intact even when an agent is driving.

## Run

```bash
cd mcp-server
python -m venv .venv && .venv\Scripts\pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt          # macOS/Linux
python server.py     # stdio transport; the CRM must be running on :8000
```

## Connect from Claude Desktop

Add to `claude_desktop_config.json`
(`%APPDATA%\Claude\` on Windows, `~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "iris-crm": {
      "command": "C:\\Users\\HP\\xeno\\mcp-server\\.venv\\Scripts\\python.exe",
      "args": ["C:\\Users\\HP\\xeno\\mcp-server\\server.py"],
      "env": { "CRM_BASE_URL": "http://localhost:8000" }
    }
  }
}
```

Restart Claude Desktop; the Iris tools appear in the tool menu. Make sure
the CRM (`:8000`) and channel service (`:8001`) are running first.
