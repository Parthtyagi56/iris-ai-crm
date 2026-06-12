import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDate, inr, pct } from "../api.js";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/api/dashboard").then(setStats).catch((e) => setError(e.message));
    api.get("/api/campaigns").then((r) => setCampaigns(r.campaigns.slice(0, 5))).catch(() => {});
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Describe the campaign — the AI builds it, you approve it.</p>
        </div>
        <Link to="/campaigns/new"><button className="primary">New campaign</button></Link>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="cards">
        <div className="card"><div className="label">Customers</div><div className="value">{stats ? stats.customers.toLocaleString("en-IN") : "—"}</div></div>
        <div className="card"><div className="label">Orders</div><div className="value">{stats ? stats.orders.toLocaleString("en-IN") : "—"}</div></div>
        <div className="card"><div className="label">Revenue</div><div className="value">{stats ? inr(stats.revenue) : "—"}</div></div>
        <div className="card"><div className="label">Campaigns</div><div className="value">{stats ? stats.campaigns : "—"}</div></div>
      </div>

      <div className="panel">
        <h2>Recent campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="muted">
            No campaigns yet. <Link to="/segments">Create an audience</Link> and launch your first one.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Channel</th><th>Status</th>
                <th className="num">Audience</th><th className="num">Delivery</th>
                <th className="num">Revenue</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/campaigns/${c.id}`)}>
                  <td>{c.name}</td>
                  <td><span className="badge channel">{c.channel}</span></td>
                  <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                  <td className="num">{c.audience_size}</td>
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
