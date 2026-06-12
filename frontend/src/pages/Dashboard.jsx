import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDate, inr, pct } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { SkeletonCards, SkeletonRows } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";

export default function Dashboard() {
  usePageTitle("Dashboard");
  const [stats, setStats] = useState(null);
  const [campaigns, setCampaigns] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/api/dashboard").then(setStats).catch((e) => setError(e.message));
    api.get("/api/campaigns").then((r) => setCampaigns(r.campaigns.slice(0, 5))).catch(() => setCampaigns([]));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Describe the campaign — the AI builds it, you approve it. Nothing sends without your sign-off.</p>
        </div>
        <Link to="/campaigns/new"><button className="primary">+ New campaign</button></Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {stats === null && !error ? (
        <SkeletonCards count={4} />
      ) : stats && (
        <div className="cards">
          <div className="card"><div className="label">Customers</div><div className="value">{stats.customers.toLocaleString("en-IN")}</div></div>
          <div className="card"><div className="label">Orders</div><div className="value">{stats.orders.toLocaleString("en-IN")}</div></div>
          <div className="card"><div className="label">Lifetime revenue</div><div className="value">{inr(stats.revenue)}</div></div>
          <div className="card"><div className="label">Campaigns</div><div className="value">{stats.campaigns}</div></div>
        </div>
      )}

      <div className="panel">
        <h2>Recent campaigns</h2>
        {campaigns === null ? (
          <table><SkeletonRows cols={6} rows={3} /></table>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon="➤"
            title="No campaigns yet"
            hint="Create an audience from plain English, draft the message with AI, and launch your first campaign."
            action={<Link to="/segments"><button className="primary">Create an audience</button></Link>}
          />
        ) : (
          <div className="table-wrap">
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
                    <td><strong>{c.name}</strong></td>
                    <td><span className="badge channel">{c.channel}</span></td>
                    <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                    <td className="num">{c.audience_size}</td>
                    <td className="num">{pct(c.stats.delivery_rate)}</td>
                    <td className="num">{inr(c.stats.attributed_revenue)}</td>
                    <td className="muted">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
