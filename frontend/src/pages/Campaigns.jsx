import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trash2, Plus } from "lucide-react";
import { api, fmtDate, inr, pct } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { useToast } from "../components/Toast.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";
import Modal from "../components/Modal.jsx";

export default function Campaigns() {
  usePageTitle("Campaigns");
  const toast = useToast();
  const [campaigns, setCampaigns] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  const filtered = (campaigns || []).filter((c) =>
    !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.channel.includes(q.toLowerCase()));

  const load = () =>
    api.get("/api/campaigns").then((r) => setCampaigns(r.campaigns)).catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.del(`/api/campaigns/${pendingDelete.id}`);
      toast(`Deleted "${pendingDelete.name}"`, "success");
      setPendingDelete(null);
      await load();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <p>Newest first. Click a row for the live funnel, AI analysis, and per-recipient log.</p>
        </div>
        <Link to="/campaigns/new"><button className="primary"><Plus size={15} /> New campaign</button></Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {campaigns !== null && campaigns.length > 0 && (
        <input
          type="search"
          aria-label="Search campaigns"
          placeholder="Search campaigns by name or channel…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 320, marginBottom: 14 }}
        />
      )}

      <div className="panel" style={{ marginTop: 0 }}>
        {campaigns === null ? (
          <table><SkeletonRows cols={9} rows={5} /></table>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon="➤"
            title="No campaigns yet"
            hint="A campaign takes an audience snapshot, personalises your template per recipient, and dispatches through the channel service."
            action={<Link to="/campaigns/new"><button className="primary">Create your first campaign</button></Link>}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Channel</th><th>Status</th>
                  <th className="num">Audience</th><th className="num">Sent</th>
                  <th className="num">Failed</th><th className="num">Delivery</th>
                  <th className="num">Revenue</th><th>Created</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/campaigns/${c.id}`)}>
                    <td><strong>{c.name}</strong></td>
                    <td><span className="badge channel">{c.channel}</span></td>
                    <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                    <td className="num">{c.audience_size}</td>
                    <td className="num">{c.stats.funnel.sent}</td>
                    <td className="num">{c.stats.failed}</td>
                    <td className="num">{pct(c.stats.delivery_rate)}</td>
                    <td className="num">{inr(c.stats.attributed_revenue)}</td>
                    <td className="muted">{fmtDate(c.created_at)}</td>
                    <td className="num">
                      <button className="row-delete" title={`Delete "${c.name}"`}
                              aria-label={`Delete ${c.name}`}
                              onClick={(e) => { e.stopPropagation(); setPendingDelete(c); }}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pendingDelete && (
        <Modal
          title="Delete this campaign?"
          onClose={() => !deleting && setPendingDelete(null)}
          footer={
            <>
              <button className="ghost" disabled={deleting} onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="primary" disabled={deleting} onClick={confirmDelete}
                      style={{ background: "var(--red)", borderColor: "var(--red)" }}>
                {deleting ? "Deleting…" : "Delete campaign"}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            <strong>{pendingDelete.name}</strong>
            {pendingDelete.status === "draft"
              ? " is a draft and will be removed."
              : " and its message history will be removed. Attributed orders are kept (revenue stays), just detached from this campaign."}
            {" "}This can’t be undone.
          </p>
        </Modal>
      )}
    </>
  );
}
