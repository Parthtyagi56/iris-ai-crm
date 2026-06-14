import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Sparkles, AlertTriangle, Inbox, ArrowUp, ArrowDown } from "lucide-react";
import { api, fmtDate, inr, pct } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { useToast } from "../components/Toast.jsx";
import Modal from "../components/Modal.jsx";
import { SkeletonCards } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { humanizeRules } from "../components/RuleEditor.jsx";

const STAGES = ["sent", "delivered", "opened", "read", "clicked", "converted"];

export default function CampaignDetail({ aiEnabled }) {
  const { id } = useParams();
  const toast = useToast();
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [msgSort, setMsgSort] = useState("updated");
  const [msgOrder, setMsgOrder] = useState("desc");
  const timer = useRef(null);

  usePageTitle(campaign ? campaign.name : "Campaign");

  const load = useCallback(
    () => api.get(`/api/campaigns/${id}`).then((c) => { setCampaign(c); setError(""); }).catch((e) => setError(e.message)),
    [id]
  );

  // Receipts keep arriving for a while after dispatch, so poll while the
  // page is open; the endpoint reads the cheap status projection.
  useEffect(() => {
    load();
    timer.current = setInterval(load, 3000);
    return () => clearInterval(timer.current);
  }, [load]);

  const launch = async () => {
    setLaunching(true);
    try {
      await api.post(`/api/campaigns/${id}/launch`, {});
      toast(`Dispatching to ${campaign.audience_size} customers`, "success");
      setConfirming(false);
      await load();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setLaunching(false);
    }
  };

  const summarize = async () => {
    setSummarizing(true);
    try {
      const res = await api.get(`/api/ai/campaigns/${id}/recommendations`);
      setSummary(res);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSummarizing(false);
    }
  };

  if (error && !campaign) {
    return (
      <EmptyState
        icon={<AlertTriangle size={20} />}
        title="Couldn't load campaign"
        hint={error}
        action={<Link to="/campaigns"><button>← All campaigns</button></Link>}
      />
    );
  }
  if (!campaign) return <SkeletonCards count={6} />;

  const { stats } = campaign;
  const live = campaign.status !== "draft";
  const maxCount = Math.max(stats.funnel.sent, 1);
  const previewText = (campaign.message_template || "")
    .replaceAll("{{first_name}}", "Asha")
    .replaceAll("{{name}}", "Asha Mehta")
    .replaceAll("{{city}}", "Mumbai");

  // Sort the recipient list client-side (status by funnel rank).
  const RANK = { queued: 0, sent: 1, delivered: 2, opened: 3, read: 4, clicked: 5, converted: 6, failed: 7 };
  const msgVal = {
    name: (m) => (m.customer_name || "").toLowerCase(),
    city: (m) => (m.city || "").toLowerCase(),
    category: (m) => (m.top_category || "").toLowerCase(),
    orders: (m) => m.order_count ?? 0,
    spend: (m) => m.total_spend ?? 0,
    status: (m) => RANK[m.status] ?? -1,
    updated: (m) => m.updated_at || "",
  };
  const messages = [...(campaign.recent_messages || [])].sort((a, b) => {
    const f = msgVal[msgSort] || msgVal.updated;
    const av = f(a), bv = f(b);
    const c = av < bv ? -1 : av > bv ? 1 : 0;
    return msgOrder === "asc" ? c : -c;
  });
  const msgSortBy = (key) => {
    if (msgSort === key) setMsgOrder(msgOrder === "asc" ? "desc" : "asc");
    else { setMsgSort(key); setMsgOrder(key === "name" ? "asc" : "desc"); }
  };
  const mInd = (key) =>
    msgSort === key ? <span className="ind">{msgOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</span> : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{campaign.name}</h1>
          <p>
            <span className="badge channel">{campaign.channel}</span>{" "}
            <span className={`badge ${campaign.status}`}>{campaign.status}</span>{" "}
            <span className="muted">
              · audience {campaign.audience_size} · created {fmtDate(campaign.created_at)}
              {campaign.started_at && ` · launched ${fmtDate(campaign.started_at)}`}
            </span>
          </p>
        </div>
        {campaign.status === "draft" && (
          <button className="primary" onClick={() => setConfirming(true)}>Review & launch</button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="cards">
        <div className="card"><div className="label">Messages</div><div className="value">{stats.total_messages}</div></div>
        <div className="card"><div className="label">Failed</div><div className="value">{stats.failed}</div></div>
        <div className="card"><div className="label">Delivery rate</div><div className="value">{pct(stats.delivery_rate)}</div></div>
        <div className="card"><div className="label">Open rate</div><div className="value">{pct(stats.open_rate)}</div></div>
        <div className="card"><div className="label">Click rate</div><div className="value">{pct(stats.click_rate)}</div></div>
        <div className="card"><div className="label">Attributed revenue</div><div className="value">{inr(stats.attributed_revenue)}</div></div>
      </div>

      <div className="panel">
        <h2>{live && <span className="live-dot" aria-hidden="true" />}Funnel{live && <span className="hint" style={{ fontWeight: 400 }}> · updating live</span>}</h2>
        <div className="funnel">
          {STAGES.map((stage) => (
            <div key={stage} className="funnel-row">
              <span className="stage">{stage}</span>
              <div className="funnel-bar">
                <div style={{ width: `${(stats.funnel[stage] / maxCount) * 100}%` }} />
              </div>
              <span className="count">
                {stats.funnel[stage]}
                <small>{stats.funnel.sent ? pct(stats.funnel[stage] / stats.funnel.sent) : ""}</small>
              </span>
            </div>
          ))}
        </div>

        {aiEnabled && (
          <div style={{ marginTop: 16 }}>
            {summary ? (
              <div className="ai-analysis">
                <div className="summary-box"><Sparkles size={15} /><span>{summary.headline}</span></div>
                <div className="recos">
                  {summary.recommendations.map((r, i) => (
                    <div key={i} className="reco">
                      <span className={`reco-pri ${r.priority}`}>{r.priority}</span>
                      <div>
                        <strong>{r.title}</strong>
                        <p>{r.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="ghost" style={{ marginTop: 4 }}
                        disabled={summarizing} onClick={summarize}>
                  {summarizing ? "Re-analysing…" : "Re-analyse"}
                </button>
              </div>
            ) : (
              <button className="ai-action subtle" disabled={summarizing || stats.total_messages === 0} onClick={summarize}>
                <Sparkles size={14} /> {summarizing ? "Analysing…" : "AI analysis & recommendations"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Targeting rules (snapshot at creation)</h2>
        <code className="rules">{humanizeRules(campaign.rules_snapshot)}</code>
      </div>

      <div className="panel">
        <h2>Recipients {messages.length > 0 && <span className="count-note">· {messages.length.toLocaleString("en-IN")} shown</span>}</h2>
        {messages.length === 0 ? (
          <EmptyState
            icon={<Inbox size={20} />}
            title="No messages yet"
            hint={campaign.status === "draft" ? "Launch the campaign to start sending." : "Messages will appear as dispatch begins."}
          />
        ) : (
          <>
          <div className="toolbar">
            <span className="count-note">Tip: click a column header to sort, or use:</span>
            <div className="spacer" />
            <div className="sort-control">
              <span>Sort</span>
              <select value={msgSort} onChange={(e) => setMsgSort(e.target.value)}>
                <option value="name">Recipient</option>
                <option value="city">City</option>
                <option value="category">Category</option>
                <option value="orders">Order count</option>
                <option value="spend">Spend</option>
                <option value="status">Status</option>
                <option value="updated">Last updated</option>
              </select>
              <button className="order-btn" title={msgOrder === "asc" ? "Ascending" : "Descending"}
                      aria-label="Toggle sort direction"
                      onClick={() => setMsgOrder(msgOrder === "asc" ? "desc" : "asc")}>
                {msgOrder === "asc" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="sortable" onClick={() => msgSortBy("name")}>Recipient{mInd("name")}</th>
                  <th className="sortable" onClick={() => msgSortBy("city")}>City{mInd("city")}</th>
                  <th className="sortable" onClick={() => msgSortBy("category")}>Buys mostly{mInd("category")}</th>
                  <th className="num sortable" onClick={() => msgSortBy("orders")}>Orders{mInd("orders")}</th>
                  <th className="num sortable" onClick={() => msgSortBy("spend")}>Spend{mInd("spend")}</th>
                  <th className="sortable" onClick={() => msgSortBy("status")}>Status{mInd("status")}</th>
                  <th>Personalised content</th>
                  <th className="sortable" onClick={() => msgSortBy("updated")}>Updated{mInd("updated")}</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id}>
                    <td><strong>{m.customer_name || m.customer_id.slice(0, 8)}</strong></td>
                    <td>{m.city || "—"}</td>
                    <td>{m.top_category ? <span className="badge channel">{m.top_category}</span> : "—"}</td>
                    <td className="num">{m.order_count ?? 0}</td>
                    <td className="num">{inr(m.total_spend ?? 0)}</td>
                    <td><span className={`badge ${m.status}`} title={m.failure_reason || ""}>{m.status}</span></td>
                    <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.content}
                    </td>
                    <td className="muted">{fmtDate(m.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <p style={{ marginTop: 16 }}>
        <Link to="/campaigns" className="muted">← All campaigns</Link>
      </p>

      {confirming && (
        <Modal
          title="Launch this campaign?"
          onClose={() => !launching && setConfirming(false)}
          footer={
            <>
              <button className="ghost" disabled={launching} onClick={() => setConfirming(false)}>Cancel</button>
              <button className="primary" disabled={launching} onClick={launch}>
                {launching ? "Launching…" : `Launch to ${campaign.audience_size} customers`}
              </button>
            </>
          }
        >
          <ul className="confirm-list">
            <li><span className="k">Campaign</span><span className="v">{campaign.name}</span></li>
            <li><span className="k">Audience</span><span className="v">{campaign.audience_size} customers</span></li>
            <li><span className="k">Channel</span><span className="v">{campaign.channel}</span></li>
          </ul>
          <div className="message-preview">{previewText}</div>
          <p className="hint" style={{ marginBottom: 0 }}>
            Preview shown for a sample recipient. Sending starts immediately and can’t be undone.
          </p>
        </Modal>
      )}
    </>
  );
}
