import { useEffect, useState } from "react";
import { api, fmtDate, inr } from "../api.js";

const LIMIT = 25;

export default function Customers() {
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ total: 0, customers: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .get(`/api/customers?q=${encodeURIComponent(q)}&limit=${LIMIT}&offset=${offset}`)
        .then(setData)
        .catch((e) => setError(e.message));
    }, q ? 300 : 0); // debounce typing, load immediately otherwise
    return () => clearTimeout(t);
  }, [q, offset]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p>{data.total.toLocaleString("en-IN")} customers ingested via the REST APIs.</p>
        </div>
      </div>

      <input
        placeholder="Search by name or email…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOffset(0); }}
        style={{ maxWidth: 340, marginBottom: 14 }}
      />

      {error && <div className="error">{error}</div>}

      <div className="panel" style={{ marginTop: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>City</th>
              <th className="num">Orders</th><th className="num">Total spend</th><th>Last order</th>
            </tr>
          </thead>
          <tbody>
            {data.customers.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.email}</td>
                <td>{c.city || "—"}</td>
                <td className="num">{c.order_count}</td>
                <td className="num">{inr(c.total_spend)}</td>
                <td>{fmtDate(c.last_order_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pager">
          <span className="muted">
            {data.total === 0 ? "0" : `${offset + 1}–${Math.min(offset + LIMIT, data.total)}`} of {data.total}
          </span>
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>← Prev</button>
          <button disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)}>Next →</button>
        </div>
      </div>
    </>
  );
}
