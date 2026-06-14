import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  IndianRupee, Users, ShoppingBag, Send, TrendingUp, TrendingDown,
  Plus, Activity, Trophy, Radio, Shirt, CalendarHeart,
  LineChart, BarChart3, Sparkles, CornerDownLeft,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, LabelList,
} from "recharts";
import { api, fmtDate, inr, pct } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { SkeletonCards, SkeletonRows } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";

const ACCENT = "#0e7c70";

// Compact rupee label, e.g. ₹9.3L, ₹85k.
function shortInr(n) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${Math.round(n / 1e3)}k`;
  return `₹${Math.round(n)}`;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-label">{label}</div>
      <strong>{inr(payload[0].value)}</strong>
    </div>
  );
}

// Revenue chart via Recharts — responsive, with axes, hover tooltips and a
// value label on every point. The library handles spacing/placement, so it
// stays consistent across data and chart types without manual tuning.
function Chart({ data, type = "area" }) {
  if (!data || data.length < 2) return null;
  const labelProps = {
    position: "top", formatter: shortInr, fontSize: 10,
    fill: "#46505f", fontWeight: 600,
  };
  const axis = { stroke: "#9aa6b6", fontSize: 10, tickLine: false };
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(20,40,40,0.08)" vertical={false} />
      <XAxis dataKey="label" {...axis} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
      <YAxis {...axis} axisLine={false} width={44} tickFormatter={shortInr} />
      <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(14,124,112,0.06)" }} />
    </>
  );
  return (
    <ResponsiveContainer width="100%" height={190}>
      {type === "bar" ? (
        <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
          {common}
          <Bar dataKey="revenue" fill={ACCENT} radius={[3, 3, 0, 0]} maxBarSize={34}>
            <LabelList dataKey="revenue" {...labelProps} />
          </Bar>
        </BarChart>
      ) : (
        <AreaChart data={data} margin={{ top: 18, right: 14, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity="0.22" />
              <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
            </linearGradient>
          </defs>
          {common}
          <Area dataKey="revenue" stroke={ACCENT} strokeWidth={2} fill="url(#revfill)"
                dot={{ r: 2.5, fill: ACCENT }} activeDot={{ r: 4 }}>
            <LabelList dataKey="revenue" {...labelProps} />
          </Area>
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}

const CHART_TYPES = [
  { id: "area", Icon: LineChart, label: "Area" },
  { id: "bar", Icon: BarChart3, label: "Bars" },
];

// Natural-language analytics over the brand's real aggregates.
function AskData() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");
  const SUGGESTED = [
    "Which category should I double down on and why?",
    "Which channel earns the most per message?",
    "Who are my most at-risk valuable customers?",
  ];

  const ask = async (question) => {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ(text);
    setBusy(true);
    setError("");
    try {
      const r = await api.post("/api/ai/ask", { question: text });
      setRes(r);
    } catch (e) {
      setError(e.message);
      setRes(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel ask-panel rise" style={{ "--i": 0 }}>
      <h2><Sparkles size={15} /> Ask your data <span className="ai-tag">AI</span></h2>
      <p className="panel-sub">Query your customers, orders and campaigns in plain language — answers come straight from your live numbers.</p>
      <div className="ask-row">
        <input
          value={q}
          placeholder='e.g. "what should I focus on this month?"'
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          aria-label="Ask a question about your data"
        />
        <button className="ai-action" disabled={busy || !q.trim()} onClick={() => ask()}>
          <CornerDownLeft size={14} /> {busy ? "Thinking…" : "Ask"}
        </button>
      </div>
      {!res && !busy && (
        <div className="ask-suggested">
          {SUGGESTED.map((s) => (
            <button key={s} className="template-chip" onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      {res && (
        <div className="ask-answer">
          <Sparkles size={15} />
          <div>
            <p>{res.answer}</p>
            {res.followups?.length > 0 && (
              <div className="ask-suggested">
                {res.followups.map((f) => (
                  <button key={f} className="template-chip" onClick={() => ask(f)}>{f}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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

export default function Dashboard({ aiEnabled }) {
  usePageTitle("Dashboard");
  const [stats, setStats] = useState(null);
  const [campaigns, setCampaigns] = useState(null);
  const [error, setError] = useState("");
  const [chartType, setChartType] = useState("area");
  const [granularity, setGranularity] = useState("weekly");
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/api/dashboard").then(setStats).catch((e) => setError(e.message));
    api.get("/api/campaigns").then((r) => setCampaigns(r.campaigns)).catch(() => setCampaigns([]));
  }, []);

  const SERIES_KEY = { weekly: "weekly_revenue", monthly: "monthly_revenue" };
  const raw = stats?.[SERIES_KEY[granularity]] || [];
  const series = raw.map((p) => p.revenue);
  // Recharts data with readable period labels on the X axis.
  const fmtPeriod = (p) => granularity === "monthly"
    ? new Date(p.month + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" })
    : new Date(p.week + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const chartData = raw.map((p) => ({ label: fmtPeriod(p), revenue: p.revenue }));
  const rangeLabel = { weekly: "last 12 weeks", monthly: "last 12 months" }[granularity];
  // Daily revenue (30-day average) shown as a number inside the customer card.
  const dailyAvg = stats?.daily_revenue?.length
    ? stats.daily_revenue.reduce((a, d) => a + d.revenue, 0) / stats.daily_revenue.length
    : 0;
  // Period-over-period: compare the last two complete buckets when possible.
  const delta =
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

      {aiEnabled && <AskData />}

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
                  {rangeLabel} below
                </div>
              </div>
              <div className="hero-controls">
                <Trend delta={delta} />
                <div className="seg-control text" role="group" aria-label="Time range">
                  {[["weekly", "Weekly"], ["monthly", "Monthly"]].map(([id, label]) => (
                    <button key={id} className={granularity === id ? "active" : ""}
                            aria-pressed={granularity === id}
                            onClick={() => setGranularity(id)}>{label}</button>
                  ))}
                </div>
                <div className="seg-control" role="group" aria-label="Chart type">
                  {CHART_TYPES.map(({ id, Icon, label }) => (
                    <button
                      key={id}
                      className={chartType === id ? "active" : ""}
                      title={label}
                      aria-label={label}
                      aria-pressed={chartType === id}
                      onClick={() => setChartType(id)}
                    >
                      <Icon size={14} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <Chart data={chartData} type={chartType} />
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
            <div className="daily-stat">
              <span>Daily revenue · 30-day avg</span>
              <strong>{inr(dailyAvg)}</strong>
            </div>
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
            <div className="table-wrap">
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
              return stats.categories.map((c, i) => {
                const flag = i === 0 ? "hot" : c.name === lowest ? "focus" : null;
                return (
                  <div key={c.name} className={`cat-row ${flag ? `flag-${flag}` : ""}`}>
                    <div className="cat-name">
                      <span className="cat-title">{c.name}</span>
                      {flag === "hot" && <span className="cat-flag hot">▲ Double down</span>}
                      {flag === "focus" && <span className="cat-flag focus">◆ Focus</span>}
                      {c.best_campaign && (
                        <span className="cat-best" title={`Best campaign: ${c.best_campaign.name}`}>
                          ★ {c.best_campaign.name}
                        </span>
                      )}
                    </div>
                    <div className="cat-bar"><div style={{ width: `${(c.revenue / maxRev) * 100}%` }} /></div>
                    <span className="cat-meta"><b>{inr(c.revenue)}</b> · {c.orders} orders · {pct(c.repeat_rate)} repeat</span>
                  </div>
                );
              });
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
