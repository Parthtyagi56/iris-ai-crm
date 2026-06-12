import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDate, inr, pct } from "../api.js";

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/api/campaigns").then((r) => setCampaigns(r.campaigns)).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <p>Newest first — click a row for the full funnel and per-message log.</p>
        </div>
        <Link to="/campaigns/new"><button className="primary">New campaign</button></Link>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel" style={{ marginTop: 0 }}>
        {campaigns === null ? (
          <p className="spinner">loading…</p>
        ) : campaigns.length === 0 ? (
          <p className="muted">
            No campaigns yet. <Link to="/campaigns/new">Create your first one</Link>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Channel</th><th>Status</th>
                <th className="num">Audience</th><th className="num">Sent</th>
                <th className="num">Failed</th><th className="num">Delivery</th>
                <th className="num">Revenue</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/campaigns/${c.id}`)}>
                  <td><strong>{c.name}</strong></td>
                  <td><span className="badge channel">{c.channel}</span></td>
                  <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                  <td className="num">{c.audience_size}</td>
                  <td className="num">{c.stats.funnel.sent}</td>
                  <td className="num">{c.stats.failed}</td>
                  <td className="num">{pct(c.stats.delivery_rate)}</td>
                  <td className="num">{inr(c.stats.attributed_revenue)}</td>
                  <td>{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
