import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  IndianRupee, Users, ShoppingBag, Send, TrendingUp, TrendingDown,
  Plus, Activity, Trophy, Radio, Shirt, CalendarHeart,
} from "lucide-react";
import { api, fmtDate, inr, pct } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { SkeletonCards, SkeletonRows } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";

// Pure-SVG sparkline; data is the real 12-week revenue series from the API.
function Sparkline({ points, width = 420, height = 56 }) {
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

const ALL_CHANNELS = ["whatsapp", "rcs", "sms", "email"];

// Retail moments worth a campaign. A real version reads a calendar service;
// the playbook shape (moment -> audience -> objective) is the product idea.
const MOMENTS = [
  { name: "End of Season Sale", month: 5, day: 26, pitch: "Clear summer stock — tease early access to your active buyers" },
  { name: "Raksha Bandhan", month: 7, day: 28, pitch: "Gifting spike — push Accessories & Beauty to recent shoppers" },
  { name: "Navratri & festive kickoff", month: 9, day: 11, pitch: "Ethnic wear surge — win back lapsed ethnic-wear buyers" },
  { name: "Diwali", month: 10, day: 8, pitch: "Biggest gifting week of the year — VIP early access + win-back" },
  { name: "Wedding season", month: 10, day: 20, pitch: "Ethnic wear + Footwear bundles for high-AOV customers" },
  { name: "Valentine's Day", month: 1, day: 14, pitch: "Dresses & gifting for couples — target active city shoppers" },
];

function upcomingMoments(count = 4) {
  const now = new Date();
  return MOMENTS.map((m) => {
    let d = new Date(now.getFullYear(), m.month, m.day);
    if (d < now) d = new Date(now.getFullYear() + 1, m.month, m.day);
    return { ...m, date: d, days: Math.ceil((d - now) / 86400000) };
  }).sort((a, b) => a.days - b.days).slice(0, count);
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
    api.get("/api/campaigns").then((r) => setCampaigns(r.campaigns)).catch(() => setCampaigns([]));
  }, []);

  const series = stats?.weekly_revenue?.map((w) => w.revenue) ?? [];
  // Week-over-week: compare the last two *complete* buckets when possible.
  const weekDelta =
    series.length >= 3 ? (series[series.length - 2] - series[series.length - 3]) / (series[series.length - 3] || 1)
    : series.length === 2 ? (series[1] - series[0]) / (series[0] || 1)
    : null;

  // Cross-campaign aggregates and per-channel rollup, all from the
  // status-projection stats the campaigns API already returns.
  const agg = useMemo(() => {
    if (!campaigns || campaigns.length === 0) return null;
    const sum = (fn) => campaigns.reduce((a, c) => a + fn(c), 0);
    const total = sum((c) => c.stats.total_messages);
    const sent = sum((c) => c.stats.funnel.sent);
    const delivered = sum((c) => c.stats.funnel.delivered);
    const opened = sum((c) => c.stats.funnel.opened);
    const clicked = sum((c) => c.stats.funnel.clicked);
    const converted = sum((c) => c.stats.funnel.converted);
    const revenue = sum((c) => c.stats.attributed_revenue);
    const byChannel = {};
    for (const c of campaigns) {
      const b = (byChannel[c.channel] ??= { campaigns: 0, total: 0, sent: 0, delivered: 0, revenue: 0 });
      b.campaigns += 1;
      b.total += c.stats.total_messages;
      b.sent += c.stats.funnel.sent;
      b.delivered += c.stats.funnel.delivered;
      b.revenue += c.stats.attributed_revenue;
    }
    const top = [...campaigns].sort(
      (a, b) => b.stats.attributed_revenue - a.stats.attributed_revenue)[0];
    return { total, sent, delivered, opened, clicked, converted, revenue, byChannel, top };
  }, [campaigns]);

  const health = stats?.customer_health;

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
          {/* Row 1 — money and base health */}
          <div className="card hero-card span-2 rise" style={{ "--i": 1 }}>
            <div className="hero-top">
              <div>
                <div className="label"><IndianRupee size={13} /> Lifetime revenue</div>
                <div className="value">{inr(stats.revenue)}</div>
                <div className="sub">
                  {agg ? <>{inr(agg.revenue)} attributed to campaigns · </> : null}
                  {inr(stats.revenue / Math.max(stats.customers, 1))} per customer
                </div>
              </div>
              <Trend delta={weekDelta} />
            </div>
            <Sparkline points={series} />
          </div>

          <div className="card rise" style={{ "--i": 2 }}>
            <div className="label"><Users size={13} /> Customer base</div>
            <div className="value">{stats.customers.toLocaleString("en-IN")}</div>
            {health && (
              <>
                <div className="health-bar" role="img"
                     aria-label={`${health.active} active, ${health.cooling} cooling, ${health.lapsed} lapsed`}>
                  <span className="seg-active" style={{ width: `${(health.active / stats.customers) * 100}%` }} />
                  <span className="seg-cooling" style={{ width: `${(health.cooling / stats.customers) * 100}%` }} />
                  <span className="seg-lapsed" style={{ width: `${(health.lapsed / stats.customers) * 100}%` }} />
                </div>
                <div className="legend">
                  <span><i className="dot-active" />{health.active} active</span>
                  <span><i className="dot-cooling" />{health.cooling} cooling</span>
                  <span><i className="dot-lapsed" />{health.lapsed} lapsed</span>
                </div>
              </>
            )}
          </div>

          <div className="card rise" style={{ "--i": 3 }}>
            <div className="label"><Activity size={13} /> Engagement</div>
            <div className="value">{agg ? agg.sent.toLocaleString("en-IN") : 0}</div>
            <div className="sub">messages sent across campaigns</div>
            {agg && agg.sent > 0 && (
              <div className="stat-pairs">
                <span className="k">Delivery</span><span className="v">{pct(agg.total ? agg.delivered / agg.total : 0)}</span>
                <span className="k">Opens</span><span className="v">{pct(agg.delivered ? agg.opened / agg.delivered : 0)}</span>
                <span className="k">Clicks</span><span className="v">{pct(agg.delivered ? agg.clicked / agg.delivered : 0)}</span>
                <span className="k">Orders won</span><span className="v">{agg.converted}</span>
              </div>
            )}
          </div>

          {/* Row 2 — where the money comes from */}
          <div className="card span-2 rise" style={{ "--i": 4 }}>
            <div className="label"><Radio size={13} /> Channel performance</div>
            <table className="mini">
              <thead>
                <tr><th>Channel</th><th className="num">Campaigns</th><th className="num">Sent</th><th className="num">Delivery</th><th className="num">Revenue</th></tr>
              </thead>
              <tbody>
                {ALL_CHANNELS.map((ch) => {
                  const b = agg?.byChannel[ch];
                  return (
                    <tr key={ch}>
                      <td><span className="badge channel">{ch}</span></td>
                      <td className="num">{b ? b.campaigns : 0}</td>
                      <td className="num">{b ? b.sent.toLocaleString("en-IN") : "—"}</td>
                      <td className="num">{b?.total ? pct(b.delivered / b.total) : "—"}</td>
                      <td className="num">{b ? inr(b.revenue) : <span className="muted">untested</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card rise" style={{ "--i": 5 }}>
            <div className="label"><Trophy size={13} /> Top campaign</div>
            {agg?.top ? (
              <>
                <div className="value" style={{ fontSize: 19, lineHeight: 1.3 }}>{agg.top.name}</div>
                <div className="stat-pairs">
                  <span className="k">Revenue</span><span className="v">{inr(agg.top.stats.attributed_revenue)}</span>
                  <span className="k">Delivery</span><span className="v">{pct(agg.top.stats.delivery_rate)}</span>
                  <span className="k">Channel</span><span className="v" style={{ textTransform: "uppercase", fontSize: 11 }}>{agg.top.channel}</span>
                  <span className="k">Audience</span><span className="v">{agg.top.audience_size}</span>
                </div>
              </>
            ) : (
              <div className="sub">No campaigns yet.</div>
            )}
          </div>

          <div className="card rise" style={{ "--i": 6 }}>
            <div className="label"><ShoppingBag size={13} /> Orders</div>
            <div className="value">{stats.orders.toLocaleString("en-IN")}</div>
            <div className="stat-pairs">
              <span className="k">Avg value</span><span className="v">{inr(stats.revenue / Math.max(stats.orders, 1))}</span>
              <span className="k">Per customer</span><span className="v">{(stats.orders / Math.max(stats.customers, 1)).toFixed(1)}</span>
            </div>
          </div>

          {/* Row 3 — what sells, and when to strike next */}
          <div className="card span-2 rise" style={{ "--i": 7 }}>
            <div className="label"><Shirt size={13} /> Category demand · revenue, repeat rate</div>
            {stats.categories?.length ? (() => {
              const maxRev = stats.categories[0].revenue || 1;
              const lowest = stats.categories[stats.categories.length - 1].name;
              return stats.categories.map((c, i) => (
                <div key={c.name} className={`cat-row ${c.name === lowest ? "lagging" : ""}`}>
                  <span className="cat-name">
                    {c.name}
                    {i === 0 && <span className="flag hot">double down</span>}
                    {c.name === lowest && <span className="flag focus">focus</span>}
                  </span>
                  <div className="cat-bar"><div style={{ width: `${(c.revenue / maxRev) * 100}%` }} /></div>
                  <span className="cat-meta"><b>{inr(c.revenue)}</b> · {c.orders} orders · {pct(c.repeat_rate)} repeat</span>
                </div>
              ));
            })() : (
              <div className="sub">No categorised orders yet — include a category column when importing.</div>
            )}
          </div>

          <div className="card span-2 rise" style={{ "--i": 8 }}>
            <div className="label"><CalendarHeart size={13} /> Upcoming moments · plan the spike before it happens</div>
            <div className="moments">
              {upcomingMoments().map((m) => (
                <div key={m.name} className="moment">
                  <div className="when">
                    <b>{m.days}d</b>
                    <span>{m.date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                  </div>
                  <div className="what">
                    <div className="name">{m.name}</div>
                    <div className="pitch">{m.pitch}</div>
                  </div>
                  <button onClick={() => navigate(`/campaigns/new?name=${encodeURIComponent(m.name + " push")}&objective=${encodeURIComponent(m.pitch)}`)}>
                    Plan
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="panel rise" style={{ "--i": 9 }}>
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
                {campaigns.slice(0, 5).map((c) => (
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
