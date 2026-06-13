import { useEffect, useState } from "react";
import { SearchX, Crown } from "lucide-react";
import { api, fmtDate, inr } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";

const LIMIT = 25;

// Presentation-layer RFM-style tier; mirrors the dashboard health
// thresholds. Real segmentation lives in the rule DSL — this is a
// glanceable label so a marketer can read the base at a row's glance.
function tier(c) {
  const now = Date.now();
  const recency = c.last_order_at
    ? (now - new Date(c.last_order_at + "Z").getTime()) / 86400000
    : Infinity;
  const joinedDays = c.created_at
    ? (now - new Date(c.created_at + "Z").getTime()) / 86400000
    : Infinity;
  if (recency > 120) return ["lapsed-tier", "Lapsed"];
  if (recency > 45) return ["atrisk", "At risk"];
  // active (ordered within 45 days) — split by value and loyalty
  if (c.total_spend >= 15000) return ["champion", "Champion"];
  if (c.order_count >= 4) return ["loyal", "Loyal"];
  if (joinedDays <= 30 && c.order_count <= 1) return ["new-tier", "New"];
  if (c.order_count <= 2) return ["promising", "Promising"];
  return ["active-tier", "Active"];
}

export default function Customers() {
  usePageTitle("Customers");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [vips, setVips] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/api/customers?limit=5&sort=top_spend`)
      .then((d) => setVips(d.customers))
      .catch(() => setVips([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .get(`/api/customers?q=${encodeURIComponent(q)}&limit=${LIMIT}&offset=${offset}`)
        .then((d) => { setData(d); setError(""); })
        .catch((e) => setError(e.message));
    }, q ? 300 : 0); // debounce typing, load immediately otherwise
    return () => clearTimeout(t);
  }, [q, offset]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p>{data ? `${data.total.toLocaleString("en-IN")} customers` : "…"} ingested through the REST APIs, with computed spend and recency.</p>
        </div>
      </div>

      <input
        type="search"
        aria-label="Search customers"
        placeholder="Search by name or email…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOffset(0); }}
        style={{ maxWidth: 340, marginBottom: 14 }}
      />

      {error && <div className="error-banner">{error}</div>}

      <div className="panel" style={{ marginTop: 0, marginBottom: 16 }}>
        <h2><Crown size={15} /> High-value customers</h2>
        <p className="panel-sub">Top lifetime spenders and what they buy — the audience to protect with VIP perks and early access.</p>
        {vips === null ? (
          <table className="mini"><SkeletonRows cols={6} rows={3} /></table>
        ) : (
          <div className="table-wrap">
            <table className="mini">
              <thead>
                <tr>
                  <th>Name</th><th>City</th><th>Buys mostly</th>
                  <th className="num">Orders</th><th className="num">Lifetime spend</th><th>Last order</th>
                </tr>
              </thead>
              <tbody>
                {vips.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.city || "—"}</td>
                    <td>{c.top_category ? <span className="badge channel">{c.top_category}</span> : "—"}</td>
                    <td className="num">{c.order_count}</td>
                    <td className="num"><strong>{inr(c.total_spend)}</strong></td>
                    <td className="muted">{fmtDate(c.last_order_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>City</th><th>Tier</th><th>Buys mostly</th>
                <th className="num">Orders</th><th className="num">Total spend</th><th>Last order</th>
              </tr>
            </thead>
            {data === null ? (
              <SkeletonRows cols={8} rows={8} />
            ) : (
              <tbody>
                {data.customers.map((c) => {
                  const [cls, label] = tier(c);
                  return (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong></td>
                      <td className="muted">{c.email}</td>
                      <td>{c.city || "—"}</td>
                      <td><span className={`badge ${cls}`}>{label}</span></td>
                      <td>{c.top_category ? <span className="badge channel">{c.top_category}</span> : "—"}</td>
                      <td className="num">{c.order_count}</td>
                      <td className="num">{inr(c.total_spend)}</td>
                      <td className="muted">{fmtDate(c.last_order_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
        {data && data.customers.length === 0 && (
          <EmptyState icon={<SearchX size={20} />} title="No customers match" hint={`Nothing found for "${q}".`} />
        )}
        {data && data.total > 0 && (
          <div className="pager">
            <span className="muted">
              {offset + 1}–{Math.min(offset + LIMIT, data.total)} of {data.total.toLocaleString("en-IN")}
            </span>
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>← Prev</button>
            <button disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)}>Next →</button>
          </div>
        )}
      </div>
    </>
  );
}
