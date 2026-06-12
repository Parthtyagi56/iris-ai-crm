import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtDate, inr, pct } from "../api.js";
import { humanizeRules } from "../components/RuleEditor.jsx";

const STAGES = ["sent", "delivered", "opened", "read", "clicked", "converted"];

export default function CampaignDetail({ aiEnabled }) {
  const { id } = useParams();
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [summary, setSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const timer = useRef(null);

  const load = useCallback(
    () => api.get(`/api/campaigns/${id}`).then(setCampaign).catch((e) => setError(e.message)),
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
    setError("");
    try {
      await api.post(`/api/campaigns/${id}/launch`, {});
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setLaunching(false);
    }
  };

  const summarize = async () => {
    setSummarizing(true);
    setError("");
    try {
      const res = await api.get(`/api/ai/campaigns/${id}/summary`);
      setSummary(res.summary);
    } catch (e) {
      setError(e.message);
    } finally {
      setSummarizing(false);
    }
  };

  if (!campaign) return <p className="spinner">{error || "loading…"}</p>;

  const { stats } = campaign;
  const maxCount = Math.max(stats.funnel.sent, 1);

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
          <button className="primary" disabled={launching} onClick={launch}>
            {launching ? "Launching…" : "Launch 🚀"}
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="cards">
        <div className="card"><div className="label">Messages</div><div className="value">{stats.total_messages}</div></div>
        <div className="card"><div className="label">Failed</div><div className="value">{stats.failed}</div></div>
        <div className="card"><div className="label">Delivery rate</div><div className="value">{pct(stats.delivery_rate)}</div></div>
        <div className="card"><div className="label">Open rate</div><div className="value">{pct(stats.open_rate)}</div></div>
        <div className="card"><div className="label">Click rate</div><div className="value">{pct(stats.click_rate)}</div></div>
        <div className="card"><div className="label">Attributed revenue</div><div className="value">{inr(stats.attributed_revenue)}</div></div>
      </div>

      <div className="panel">
        <h2>Funnel</h2>
        <div className="funnel">
          {STAGES.map((stage) => (
            <div key={stage} className="funnel-row">
              <span className="stage">{stage}</span>
              <div className="funnel-bar">
                <div style={{ width: `${(stats.funnel[stage] / maxCount) * 100}%` }} />
              </div>
              <span className="count">{stats.funnel[stage]}</span>
            </div>
          ))}
        </div>

        {aiEnabled && (
          <div style={{ marginTop: 16 }}>
            {summary ? (
              <div className="summary-box">✦ {summary}</div>
            ) : (
              <button disabled={summarizing || stats.total_messages === 0} onClick={summarize}>
                {summarizing ? "Analysing…" : "✦ AI performance summary"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Targeting rules (snapshot at creation)</h2>
        <code style={{ fontSize: 12 }}>{humanizeRules(campaign.rules_snapshot)}</code>
      </div>

      <div className="panel">
        <h2>Recent messages</h2>
        {(campaign.recent_messages || []).length === 0 ? (
          <p className="muted">
            No messages yet{campaign.status === "draft" && " — launch the campaign to start sending"}.
          </p>
        ) : (
          <table>
            <thead>
              <tr><th>Status</th><th>Content</th><th>Failure</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {campaign.recent_messages.map((m) => (
                <tr key={m.id}>
                  <td><span className={`badge ${m.status}`}>{m.status}</span></td>
                  <td style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.content}
                  </td>
                  <td className="muted">{m.failure_reason || "—"}</td>
                  <td>{fmtDate(m.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 16 }}>
        <Link to="/campaigns" className="muted">← All campaigns</Link>
      </p>
    </>
  );
}
