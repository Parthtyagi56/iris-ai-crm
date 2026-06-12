import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
      const res = await api.get(`/api/ai/campaigns/${id}/summary`);
      setSummary(res.summary);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSummarizing(false);
    }
  };

  if (error && !campaign) {
    return (
      <EmptyState
        icon="⚠"
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
        <code className="rules">{humanizeRules(campaign.rules_snapshot)}</code>
      </div>

      <div className="panel">
        <h2>Recent messages</h2>
        {(campaign.recent_messages || []).length === 0 ? (
          <EmptyState
            icon="✉"
            title="No messages yet"
            hint={campaign.status === "draft" ? "Launch the campaign to start sending." : "Messages will appear as dispatch begins."}
          />
        ) : (
          <div className="table-wrap">
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
                    <td className="muted">{fmtDate(m.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
