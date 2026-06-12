import { useEffect, useState } from "react";
import { SearchX } from "lucide-react";
import { api, fmtDate, inr } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";

const LIMIT = 25;

export default function Customers() {
  usePageTitle("Customers");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

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

      <div className="panel" style={{ marginTop: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>City</th>
                <th className="num">Orders</th><th className="num">Total spend</th><th>Last order</th>
              </tr>
            </thead>
            {data === null ? (
              <SkeletonRows cols={6} rows={8} />
            ) : (
              <tbody>
                {data.customers.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td className="muted">{c.email}</td>
                    <td>{c.city || "—"}</td>
                    <td className="num">{c.order_count}</td>
                    <td className="num">{inr(c.total_spend)}</td>
                    <td className="muted">{fmtDate(c.last_order_at)}</td>
                  </tr>
                ))}
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
