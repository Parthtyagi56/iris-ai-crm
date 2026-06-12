# Decision log — Aurelia Mini CRM

Every significant decision in this project, the alternatives considered, and
the trade-offs. Written to be defensible in a live code review: "I'd do X at
scale but did Y for this scope" is stated explicitly wherever it applies.

---

## 1. Product point of view: artifact-first AI, not chat-first

**Decision.** The marketer describes intent in natural language; the AI
responds with **structured, editable artifacts** — segment rules with a live
audience count, message variants, a performance narrative. Nothing sends
without an explicit human approval step (the launch confirmation modal shows
audience size, channel, and a rendered sample message).

**Alternatives considered.**
- *Chat-first UI* — a conversation that drives everything.
- *Full autonomous agent* — give it a goal, it runs the campaign.

**Why artifact-first won.**
- Marketing sends are **irreversible and expensive** (brand damage, spam
  complaints). The human needs to see exactly *who* and *what* before commit.
  A chat transcript hides state; an artifact shows it.
- Artifacts are **editable** — if the AI gets a rule slightly wrong, the
  marketer fixes one condition instead of re-prompting and hoping.
- It degrades gracefully: with no API key, the same UI works fully manually.
  A chat-first product without AI is an empty page.

**Cost of this choice.** Less "wow" than an agent demo; more UI to build
(rule editor, preview, variants). Accepted: trust is the product.

## 2. Two services, HTTP-only, zero shared code

**Decision.** The CRM (FastAPI) and the channel simulator (FastAPI) are
separate deployables that communicate only over HTTP — `POST /send` one way,
`POST /api/receipts` callbacks the other. No shared models, no shared
package, not even shared constants.

**Why.** The assignment models a real channel provider (Twilio/Meta/Gupshup).
Real providers don't import your code. Keeping the boundary honest forced
real-system problems to surface: authentication of callbacks, duplicate
deliveries, out-of-order arrival — and made the receipt ingestion genuinely
defensive instead of theatrically so.

**Trade-offs.** Some duplication (both sides define an event shape). At
scale the contract would be an OpenAPI/JSON-schema spec both sides validate
against; for two small services, duplication is cheaper than coupling.

## 3. Events ledger + status projection (the core data-model bet)

**Decision.** `message_events` is an append-only ledger of everything the
channel reported. `messages.status` is a **projection** — a read-model
updated by a small state machine. Funnel stats are computed from
`status_rank` on the projection, never by scanning the ledger.

**The state machine rules:**
1. `event_id` has a UNIQUE constraint → re-delivered callbacks are
   **idempotent no-ops** (caught as `IntegrityError`, not pre-checked —
   no TOCTOU race).
2. Statuses have a **monotonic rank** (`queued < sent < delivered < opened <
   read < clicked < converted`; `failed` terminal). A projection only moves
   forward → out-of-order arrivals **never regress state**. A late
   `delivered` arriving after `clicked` is still recorded in the ledger
   (audit) but doesn't touch the projection.
3. `converted` creates an attributed `Order` row (`campaign_id` FK) →
   message → revenue attribution is closed.

**Why ranks instead of timestamps?** Provider timestamps are untrustworthy
(clock skew, equal timestamps, missing values). A total order over statuses
is deterministic and needs no clock. The cost: a genuinely weird sequence
(`clicked` then `failed`) resolves by rank, not truth — acceptable because
the ledger still holds the truth for audit.

**Why not full event sourcing?** Rebuilding state from events on every read
is overkill at this scope. The ledger gives the auditability benefit; the
projection gives O(1) reads. This is "event sourcing lite" — the part of the
pattern that pays rent.

**Funnel semantics.** A message at `rank >= stage` has passed through that
stage (ranks only move forward), so funnel counts are a single indexed
`GROUP BY` — no event-table scans per dashboard request.

## 4. A whitelisted rule DSL instead of AI-written SQL

**Decision.** The AI never writes SQL. It emits a small JSON DSL —
`{op: and/or, conditions: [{field, cmp, value}]}`, nestable — validated by
Pydantic against whitelisted fields/comparators, then compiled to SQLAlchemy
by a deterministic compiler (`segment_engine.py`).

**Why.**
1. **Safety** — prompt injection or model error can produce at worst an
   invalid rule (rejected loudly), never `DROP TABLE` or a tenant-boundary
   leak.
2. **UX** — rules are data, so the UI renders them as an editable rule tree
   with a live audience preview. SQL strings can't be safely edited by a
   marketer.
3. **Auditability** — campaigns snapshot `rules_snapshot` JSON. You can
   answer "who did we target and why" forever, even after the segment is
   edited.

**Trade-offs.** Less expressive than SQL (no joins, no window functions —
"customers whose 3rd order was > ₹2000" is out). Fields are pre-aggregated
(`total_spend`, `days_since_last_order`…). Accepted: those six fields cover
the RFM-style segmentation marketers actually do; new fields are one line in
the whitelist + compiler.

**NULL-safety detail worth knowing:** "days_since_last_order > 60" must
decide what to do with customers who have **never ordered**. The compiler
treats never-ordered as "infinitely lapsed" (matches `>` thresholds, fails
`<` thresholds) — deliberate, documented in `segment_engine.py`, covered by
tests.

## 5. Dispatch design: write first, send second

**Decision.** Launching a campaign:
1. Materialises the audience **from the rules snapshot** and inserts one
   `messages` row per recipient (status `queued`) — *before any network
   call*.
2. POSTs to the channel in **batches of 100** with bounded exponential
   backoff retries.
3. Marks each batch `sent` or `failed` by the dispatch outcome; the channel
   ACKs 202 and everything else arrives later as receipts.

**Why queued-rows-first.** If the process dies mid-dispatch, the DB knows
exactly which messages were never attempted (still `queued`). Recovery and
delivery guarantees become a database question, not a memory question. This
is also precisely the shape that migrates to a real queue: the `queued` row
*is* the job.

**Why batches of 100.** One call per message is chatty (871 calls for our
test campaign); one call for everything makes a single failure atomic over
the whole campaign. 100 bounds both failure blast radius and payload size.

**Why FastAPI `BackgroundTasks` and not Celery/SQS.** Single process,
thousands of sends, four days. The interface boundary (row-first, batched,
idempotent receipts) is what makes the migration to SQS/Kafka + workers a
swap, not a rewrite. At scale: queue with visibility timeouts, worker pool,
partition receipts by `message_id` so per-message ordering is free.

## 6. Receipt ingestion: idempotent, unordered, authenticated

**Decision.** The receipts endpoint:
- Verifies an **HMAC-SHA256 signature over the raw request bytes** before
  parsing JSON (parse-then-verify is a vulnerability: parsers normalise).
- Applies events through the state machine (§3) — duplicates and reordering
  are handled by construction, not by special cases.
- Returns per-event results; the channel retries 5xx with backoff.

**Why HMAC and not bearer tokens.** A static token leaks in logs and proves
nothing about the *body*. HMAC binds the secret to the payload — a replayed
or tampered body fails. At scale add a timestamp + tolerance window to kill
replays entirely (documented, consciously skipped).

**Synchronous processing trade-off.** Receipts are processed in the request
handler. At provider scale you'd enqueue and ACK immediately (webhook → queue
→ consumers). The correctness properties (idempotency, forward-only ranks)
are already queue-shaped — consumers could process the same events in any
order and converge to the same state.

## 7. The simulator deliberately misbehaves

~8% hard failures, per-channel engagement profiles (WhatsApp ≫ email opens),
random delays, ~15% of lifecycles delivered out of order, ~10% duplicate
callbacks, retries with backoff when the CRM 5xxes, every callback signed.

**Why.** A well-behaved simulator would make the CRM's defensive code
unfalsifiable. The misbehaviour is what *proves* idempotency and ordering
robustness in every demo run. `occurred_at` always reflects true event order
— only **arrival** order is scrambled, which mirrors reality (the provider
knows what happened; the network scrambles delivery).

## 8. AI integration: forced tool calls, validated output

**Decision.** All three AI touchpoints use the same pattern: the model is
forced into a tool call (`tool_choice: {type: "tool"}`) whose JSON schema
mirrors our Pydantic schemas; the result is validated with Pydantic before
anything downstream sees it. AI proposes; deterministic code disposes.

**Why not free-text + regex/JSON.parse.** Tool-forcing moves "produce valid
JSON" from prompt-engineering hope to API contract. Validation failure is a
loud 4xx/5xx, not silent data corruption.

**The three touchpoints** (one pattern, three leverage points):
| Endpoint | Input → Output |
|---|---|
| `POST /api/ai/segment` | NL prompt → rules DSL + name + explanation + live preview count |
| `POST /api/ai/draft` | objective + channel → 2-3 labelled variants, channel-specific constraints, personalisation tokens |
| `GET /api/ai/campaigns/{id}/summary` | funnel stats JSON → 2-3 sentence analyst narrative |

**The copilot (the distinguisher).** `POST /api/ai/chat` is a chat interface
over the same artifact discipline: the marketer describes a goal, the model
returns `{reply, plan?}` where the plan is a complete campaign proposal —
segment name + rules, channel + one-line reasoning, 1–3 message variants.
The backend validates the rules with Pydantic, attaches a live audience
count, and the UI renders it as an **editable artifact card**, not executed
actions. "Looks right — create it" calls the same `/api/segments` and
`/api/campaigns` endpoints a human would; launch still goes through the
approval modal. So the copilot sits exactly between "chat-first" and "agent":
it can *think and decide* (audience, channel, copy in one turn) but cannot
*act* past the draft boundary. If a proposed plan fails validation, the chat
says so honestly instead of letting a broken plan reach the approve button.
Deliberately NOT a tool-calling agent loop: one structured response per turn
is simpler to validate, works identically on free-tier providers without
reliable function calling, and keeps worst-case latency at one model call.

**Provider-agnostic, free-tier friendly.** The AI layer speaks two dialects:
Anthropic (forced tool call) and any OpenAI-compatible `/chat/completions`
(JSON mode + schema-in-prompt, with a fallback when a provider rejects
`response_format`). Groq, Google Gemini, OpenRouter free models, and local
Ollama all work via three env vars. Direct `httpx` call rather than the
OpenAI SDK: one less dependency, and the request is ~20 lines.

**Graceful degradation.** `GET /api/ai/status` lets the frontend hide AI
affordances when no key is configured; every AI feature has a manual path
(the copilot page shows free-key setup steps instead of a dead chat).

**At scale:** prompt caching for the static system prompts, a cheaper model
for drafts, and few-shot examples mined from accepted/rejected artifacts.

## 9. Frontend: Vite + React SPA, no component library

**Decision.** Hand-rolled design system (CSS custom properties, one
stylesheet), React Router, no Tailwind/MUI/shadcn, no state-management
library. Custom Toast/Modal/Skeleton/EmptyState/ErrorBoundary components.

**Why.**
- The UI surface is four pages; a component library is a dependency tax
  (bundle, theming fights, upgrade churn) with little payoff at this size.
  Total JS is ~198 KB / ~62 KB gzip — including React.
- Server state is simple request/response; `useState` + `useEffect` with
  debouncing and sequence guards (`previewSeq`) covers it. React Query would
  be the call the moment caching/invalidation appears.
- The launch **confirmation modal is product, not chrome** — it's the
  "human approves" half of the POV, so it shows audience size, channel, and
  a rendered sample message at the moment of commitment.

**Design language.** Slate neutrals with a teal action color, Plus Jakarta
Sans for display/stats over Inter for UI, deep slate sidebar against a
light content area, lucide icons, dot-style status badges. Deliberate
avoidances: purple-gradient-on-dark (the generic AI-dashboard signature)
and Tailwind-default indigo. The dashboard is a bento grid whose hero card
charts a real 12-week revenue series from the API (pure-SVG sparkline — a
chart library for one sparkline is a dependency tax). Motion is CSS-only:
staggered entrances with a `prefers-reduced-motion` fallback; the only
icon dependency is tree-shaken lucide-react (~10 KB gzip added). Semantic
color is reserved for state (green converted, red failed, amber
dispatching), so the accent never competes with meaning.

**Polling vs WebSockets for the live funnel.** 3-second polling against an
indexed projection read. WebSockets/SSE are better at scale (no thundering
herd), but polling is stateless, proxy-friendly, and trivially correct —
and receipts arrive for minutes, not milliseconds, after dispatch.

## 10. Stack and storage

| Choice | Why | At scale |
|---|---|---|
| FastAPI + Pydantic | Schema validation at every boundary is the backbone of the AI-safety story; async fits the I/O-bound dispatch loop | Holds up; add gunicorn workers |
| SQLAlchemy + SQLite locally / Postgres in deploy | One `DATABASE_URL` swap; SQLite keeps local setup zero-config | Postgres + read replicas for dashboards |
| `create_all` on boot | One schema, four days | Alembic migrations |
| Per-request status counts | Indexed `(campaign_id, status)` GROUP BY is microseconds at this volume | Incremental counters / materialised rollups |
| Seeded data (1,200 customers / ~5k orders, Faker) | Shaped RFM distributions so segments return plausible counts; demo needs realistic data, not real data | — |

## 11. What was consciously cut

- **Auth / multi-tenancy** — single-brand demo. At scale: org-scoped rows +
  JWT; the rule DSL whitelist already prevents cross-tenant query leaks.
- **Replay-window on HMAC** (timestamp tolerance) — documented above.
- **Scheduled/recurring campaigns, A/B sends, control groups** — the data
  model anticipates them (draft endpoint already returns variants; rules
  snapshots make holdouts honest) but UI/scheduler was out of scope.
- **Segment editing after save** — rules are data so it's pure frontend;
  the audience builder already edits unsaved rules.
- **Alembic, queues, websockets, React Query** — each has its "at scale"
  note above.

## 12. Data ingestion: API-first, CSV as the universal adapter

**Decision.** Ingestion is a contract, not a connector zoo. Two live paths:

1. **Bulk REST endpoints** (`POST /api/customers/bulk`, `POST /api/orders/bulk`)
   with defensive semantics: customers dedupe on email (re-pushing a feed is
   safe), orders resolve `customer_email → id` and *report* unknowns instead
   of failing the batch. This is the surface a Shopify webhook bridge, a CDP
   (Segment HTTP destination), or a reverse-ETL job from a warehouse targets.
2. **CSV import in the UI** — parsed client-side (header validation, preview,
   500-row chunks), then sent through the *same* bulk endpoints. No second
   ingestion code path to keep correct; the UI is just another API client.
   CSV matters because it's the lowest common denominator: every commerce
   tool, POS, and spreadsheet exports it — so "new data provider" day one
   is an export, not an integration project.

**Why not build native connectors (Shopify OAuth etc.)?** Each one is auth
plumbing + rate-limit handling + schema mapping for a single vendor — days
of work that demonstrates nothing new architecturally. The Data sources page
shows the catalog honestly: every tile works today via the two live paths;
native connectors are roadmap. **At scale:** per-provider webhook receivers
(verified like the channel receipts: signature over raw bytes), a queue
between receipt and processing, upsert semantics keyed on a stable external
id (`shopify:order:123`) instead of email, and incremental sync cursors.
The industrial alternative — Fivetran/Airbyte into a warehouse, reverse-ETL
back — is the right answer when the brand already has a data team.

**Category analytics and moments.** Orders carry a product category
(seeded with per-customer preferences so repeat-purchase analytics mean
something; accepted on the ingest APIs and CSV import). The dashboard turns
that into a demand view — revenue, order volume, and repeat rate per
category, flagging the leader ("double down") and the laggard ("focus") —
plus an event playbook of upcoming retail moments (EOSS, Raksha Bandhan,
Diwali…) with one-click campaign prefill. The moment list is a curated
constant; a real version reads a calendar service, but the product shape —
moment → suggested audience → prefilled objective — is the point.

## 13. Likely interview questions, with answers

**"Walk me through what happens when I click Launch."**
Audience is materialised from the campaign's rules snapshot → one `queued`
message row per recipient (transactional) → batches of 100 POSTed to the
channel with backoff retries → rows flipped `sent`/`failed` per batch
outcome → channel ACKs 202 → over the next seconds-to-minutes the channel
calls `POST /api/receipts` with signed event batches → state machine applies
them (idempotent, forward-only) → `converted` events write attributed
orders → the UI polls the projection and the funnel fills.

**"What if the same receipt arrives twice?"**
UNIQUE on `event_id`; the insert raises `IntegrityError`, we treat it as a
no-op and return success (so the channel stops retrying). No pre-check —
the constraint *is* the check, so there's no race window.

**"What if `opened` arrives before `delivered`?"**
Ledger records both in arrival order; projection takes the max rank, so it
goes to `opened` and the late `delivered` doesn't regress it. Truth lives in
`occurred_at` in the ledger if anyone needs forensics.

**"Why didn't you let the AI write SQL? It would be more powerful."**
More powerful and unauditable. The DSL is the security boundary, the
editability story, and the audit story at once. Power I can add field by
field; safety retrofitted is a rewrite. (Full argument in §4.)

**"Where does this break at 10× / 1000× volume?"**
10×: nothing — indexes and batching already carry it. 1000×: dispatch moves
to a queue + workers (the `queued` row is already the job), receipts move to
webhook → queue → partitioned consumers (idempotency makes consumers
trivially safe), status counts move to incremental rollups, Postgres gets
partitioning on `messages(campaign_id)`. No schema changes — that was the
point of the row-first, rank-based design.

**"Why didn't you use LangChain / an agent framework?"**
Three endpoints, one pattern: forced tool call + Pydantic validation. A
framework would add an abstraction layer over ~60 lines of direct API code
that I'd then have to explain. I'd reach for one when chains get deep or
tools get numerous.

**"How does a new data source — say our POS vendor — get into this?"**
Day one: their CSV export through the importer, or a 20-line script hitting
the bulk endpoints — both land on the same idempotent ingest contract.
Properly: a webhook receiver for that vendor (HMAC-verified like the channel
receipts), queue, upsert keyed on their stable external id. The contract
doesn't change; only the transport does. (Full argument in §12.)

**"How would you A/B test message variants?"**
The draft endpoint already returns labelled variants. Add `variant` to the
message row, split the audience deterministically (hash of customer id),
and the funnel query gains a GROUP BY. Control-group holdouts the same way
— a held-out slice that gets no message but is tracked for conversion, which
makes attribution honest instead of last-touch-optimistic.
