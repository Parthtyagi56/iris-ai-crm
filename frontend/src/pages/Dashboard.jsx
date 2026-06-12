import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  IndianRupee, Users, ShoppingBag, Send, TrendingUp, TrendingDown, Plus,
} from "lucide-react";
import { api, fmtDate, inr, pct } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { SkeletonCards, SkeletonRows } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";

// Pure-SVG sparkline; data is the real 12-week revenue series from the API.
function Sparkline({ points, width = 420, height = 64 }) {
  if (!points || points.length < 2) return null;
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const xy = points.map((v, i) => [i * step, height - 6 - ((v - min) / range) * (height - 14)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
         role="img" aria-label="Weekly revenue trend">
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d9488" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkfill)" />
      <path d={line} fill="none" stroke="#0d9488" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="3" fill="#0d9488" />
    </svg>
  );
}

function Trend({ delta }) {
  if (delta === null) return null;
  const up = delta >= 0;
  return (
    <span className={`trend ${up ? "up" : "down"}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(delta * 100).toFixed(0)}%
    </span>
  );
}

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

  const series = stats?.weekly_revenue?.map((w) => w.revenue) ?? [];
  // Week-over-week: compare the last two *complete* buckets when possible.
  const weekDelta =
    series.length >= 3 ? (series[series.length - 2] - series[series.length - 3]) / (series[series.length - 3] || 1)
    : series.length === 2 ? (series[1] - series[0]) / (series[0] || 1)
    : null;

  return (
    <>
      <div className="page-head rise">
        <div>
          <h1>Dashboard</h1>
          <p>Describe the campaign — the AI builds it, you approve it. Nothing sends without your sign-off.</p>
        </div>
        <Link to="/campaigns/new"><button className="primary"><Plus size={15} /> New campaign</button></Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {stats === null && !error ? (
        <SkeletonCards count={4} />
      ) : stats && (
        <div className="bento">
          <div className="card hero-card span-2 rise" style={{ "--i": 1 }}>
            <div className="hero-top">
              <div>
                <div className="label"><IndianRupee size={13} /> Lifetime revenue</div>
                <div className="value">{inr(stats.revenue)}</div>
                <div className="sub">{inr(stats.revenue / Math.max(stats.customers, 1))} per customer · last 12 weeks below</div>
              </div>
              <Trend delta={weekDelta} />
            </div>
            <Sparkline points={series} />
          </div>
          <div className="card rise" style={{ "--i": 2 }}>
            <div className="label"><Users size={13} /> Customers</div>
            <div className="value">{stats.customers.toLocaleString("en-IN")}</div>
            <div className="sub">{(stats.orders / Math.max(stats.customers, 1)).toFixed(1)} orders each</div>
          </div>
          <div className="card rise" style={{ "--i": 3 }}>
            <div className="label"><ShoppingBag size={13} /> Orders</div>
            <div className="value">{stats.orders.toLocaleString("en-IN")}</div>
            <div className="sub">{inr(stats.revenue / Math.max(stats.orders, 1))} avg value</div>
          </div>
        </div>
      )}

      <div className="panel rise" style={{ "--i": 4 }}>
        <h2><Send size={15} /> Recent campaigns</h2>
        {campaigns === null ? (
          <table><SkeletonRows cols={6} rows={3} /></table>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={<Send size={20} />}
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
