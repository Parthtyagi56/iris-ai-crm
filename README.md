# Aurelia Mini CRM — AI-native shopper engagement

A take on the Xeno assignment: an AI-native mini CRM for a D2C brand, built
around one product point of view — **you describe the campaign, the AI builds
it, you approve it.** The marketer expresses intent in natural language; the
AI answers with *structured, editable artifacts* (segment rules with a live
audience preview, message variants, channel suggestion). Nothing sends
without explicit human approval.

## Architecture

```
┌─────────────┐  REST   ┌──────────────────────┐  POST /send   ┌──────────────────┐
│  React SPA  │ ──────► │   CRM API (FastAPI)  │ ────────────► │ Channel Simulator│
│  (Vercel)   │         │  customers · orders  │   batches,    │    (FastAPI)     │
└─────────────┘         │  segments · campaigns│   retries     │  async lifecycle │
                        │  messages · events   │               │  simulation      │
                        │  AI endpoints        │ ◄──────────── │  per message     │
                        └──────────┬───────────┘  POST         └──────────────────┘
                                   │              /api/receipts
                              Postgres/SQLite     (HMAC-signed, retried,
                                                   duplicated, out-of-order)
```

Two genuinely separate services with no shared code — they speak only HTTP,
like a real CRM and a real channel provider would.

### The delivery loop (the part that matters)

1. **Dispatch** — launching a campaign materialises the audience from the
   segment's rule snapshot, writes one `messages` row per recipient
   (`queued`) *before any network call*, then POSTs to the channel in
   batches of 100 with bounded exponential-backoff retries. The channel ACKs
   202; nothing about outcomes is known yet.
2. **Simulation** — the channel asynchronously decides each message's fate
   (per-channel engagement profiles, ~8% hard failures) and calls back into
   `POST /api/receipts`. It deliberately misbehaves like real providers:
   random delays, ~15% of lifecycles delivered out of order, ~10% duplicate
   callbacks, retries with backoff when the CRM errors, and every callback
   HMAC-signed.
3. **Ingestion** — the CRM verifies the signature against raw bytes, then
   applies each event through a small state machine:
   * `message_events.event_id` is UNIQUE → **duplicates are idempotent no-ops**
   * statuses have a monotonic rank and only move forward → **out-of-order
     arrivals never regress state** (a late `delivered` after `clicked` is
     recorded in the ledger but doesn't change the projection)
   * `failed`/`converted` are terminal; `converted` creates an **attributed
     order**, closing the loop from message → revenue.

Events are the source of truth (append-only ledger); `messages.status` is a
read-model projection. Funnel stats read straight off `status_rank`, so the
insights page needs no event-table scans.

## AI integration (three touchpoints, one pattern)

| Where | What |
|---|---|
| `POST /api/ai/segment` | Natural language → segment rule DSL → live audience count + sample, in one round trip |
| `POST /api/ai/draft` | Objective → 2–3 message variants with channel-specific constraints and personalisation tokens |
| `GET /api/ai/campaigns/{id}/summary` | Campaign stats → 2–3 sentence analyst-style narrative |

The pattern everywhere: the model is forced into a tool call whose schema
mirrors our Pydantic schemas, and the output is **validated before anything
trusts it**. The AI never writes SQL — it writes a small whitelisted rule
DSL (`app/schemas.py`) that a deterministic compiler
(`app/services/segment_engine.py`) turns into a query. AI proposes; code
disposes.

## Repository layout

```
backend/
  app/
    main.py                 FastAPI app, CORS, dashboard
    config.py               env-driven settings
    models.py               6 tables; events ledger + status projection
    schemas.py              Pydantic schemas incl. the segment rule DSL
    routers/                ingest · segments · campaigns · receipts · ai
    services/
      segment_engine.py     DSL → SQLAlchemy compiler (NULL-safe recency logic)
      dispatcher.py         audience → messages → batched channel sends
      receipt_processor.py  idempotent, out-of-order-safe state machine
      ai_service.py         Anthropic calls, tool-forced JSON, validated
    seed.py                 1,200 customers / ~5k orders, shaped RFM profiles
  tests/                    12 tests: state machine + DSL semantics
channel-service/
  app/main.py               the simulator (no shared code with the CRM)
```

## Running locally

```bash
# Terminal 1 — channel simulator
cd channel-service
pip install -r requirements.txt
uvicorn app.main:app --port 8001

# Terminal 2 — CRM
cd backend
pip install -r requirements.txt
cp .env.example .env            # add ANTHROPIC_API_KEY for AI features
python -m app.seed
uvicorn app.main:app --port 8000
```

API docs at http://localhost:8000/docs. Tests: `cd backend && pytest`.
`./e2e_test.sh` (repo root) runs the whole loop unattended and prints the
resulting funnel.

## Deployment shape

* **CRM API + channel service** → two Render (or Railway) web services.
* **Postgres** → Neon free tier; set `DATABASE_URL`.
* **Frontend** → Vercel, pointing at the CRM URL.
* Set `CRM_PUBLIC_URL` to the CRM's public URL (the channel calls back into
  it) and the same `WEBHOOK_SECRET` on both services.

## Scale assumptions & conscious trade-offs

| Did here | Would do at scale | Why fine for this scope |
|---|---|---|
| FastAPI `BackgroundTasks` for dispatch | Queue (SQS/Kafka) + worker pool; survives restarts, horizontally scalable | Single process, thousands not millions of sends. The `queued`-row-first design migrates without schema changes. |
| Synchronous receipt processing | Webhook → queue → consumers; partition by `message_id` | Idempotency + forward-only ranks already give the same correctness guarantees |
| `create_all` on boot | Alembic migrations | One schema, four days |
| Status counts computed per request | Incremental counters / materialised rollups | Indexed `(campaign_id, status)` is plenty at this volume |
| Single AI model, no caching | Prompt caching, cheaper model for drafts | Cost is negligible at demo volume |

## What I'd build next

Segment editing UI for AI-generated rules (the API already treats rules as
data, so this is pure frontend), scheduled/recurring campaigns, A/B sending
of message variants (the draft endpoint already returns multiple), and
control-group holdouts for honest attribution.
