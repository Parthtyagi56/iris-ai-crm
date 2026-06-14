import { useEffect, useState } from "react";
import { SearchX, Crown, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { api, fmtDate, inr } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { useToast } from "../components/Toast.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";
import Modal from "../components/Modal.jsx";

const LIMIT = 25;

const SORTS = [
  { id: "recent", label: "Recently joined" },
  { id: "name", label: "Name" },
  { id: "spend", label: "Total spend" },
  { id: "orders", label: "Order count" },
  { id: "last_order", label: "Last order" },
];
// Maps a sortable column header to its sort key.
const COL_SORT = { name: "name", orders: "orders", spend: "spend", last_order: "last_order" };

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
  if (c.total_spend >= 15000) return ["champion", "Champion"];
  if (c.order_count >= 4) return ["loyal", "Loyal"];
  if (joinedDays <= 30 && c.order_count <= 1) return ["new-tier", "New"];
  if (c.order_count <= 2) return ["promising", "Promising"];
  return ["active-tier", "Active"];
}

export default function Customers() {
  usePageTitle("Customers");
  const toast = useToast();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState("recent");
  const [order, setOrder] = useState("desc");
  const [data, setData] = useState(null);
  const [vips, setVips] = useState(null);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadVips = () =>
    api.get(`/api/customers?limit=5&sort=top_spend`)
      .then((d) => setVips(d.customers))
      .catch(() => setVips([]));

  useEffect(() => { loadVips(); }, [reloadKey]);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .get(`/api/customers?q=${encodeURIComponent(q)}&limit=${LIMIT}&offset=${offset}&sort=${sort}&order=${order}`)
        .then((d) => { setData(d); setError(""); })
        .catch((e) => setError(e.message));
    }, q ? 300 : 0); // debounce typing, load immediately otherwise
    return () => clearTimeout(t);
  }, [q, offset, sort, order, reloadKey]);

  // Click a sortable header: same column toggles direction, new column resets to desc.
  const sortBy = (key) => {
    if (sort === key) setOrder(order === "asc" ? "desc" : "asc");
    else { setSort(key); setOrder(key === "name" ? "asc" : "desc"); }
    setOffset(0);
  };
  const ind = (key) =>
    sort === key ? <span className="ind">{order === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</span> : null;

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.del(`/api/customers/${pendingDelete.id}`);
      toast(`Deleted ${pendingDelete.name}`, "success");
      setPendingDelete(null);
      setReloadKey((k) => k + 1);
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
          <h1>Customers</h1>
          <p>{data ? `${data.total.toLocaleString("en-IN")} customers` : "…"} ingested through the REST APIs, with computed spend and recency.</p>
        </div>
      </div>

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

      <div className="toolbar">
        <input
          type="search"
          aria-label="Search customers"
          placeholder="Search by name or email…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOffset(0); }}
          style={{ maxWidth: 300 }}
        />
        <div className="spacer" />
        <div className="sort-control">
          <span>Sort</span>
          <select value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="order-btn" title={order === "asc" ? "Ascending" : "Descending"}
                  aria-label="Toggle sort direction"
                  onClick={() => { setOrder(order === "asc" ? "desc" : "asc"); setOffset(0); }}>
            {order === "asc" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel" style={{ marginTop: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => sortBy("name")}>Name{ind("name")}</th>
                <th>Email</th><th>City</th><th>Tier</th><th>Buys mostly</th>
                <th className="num sortable" onClick={() => sortBy("orders")}>Orders{ind("orders")}</th>
                <th className="num sortable" onClick={() => sortBy("spend")}>Total spend{ind("spend")}</th>
                <th className="sortable" onClick={() => sortBy("last_order")}>Last order{ind("last_order")}</th>
                <th></th>
              </tr>
            </thead>
            {data === null ? (
              <SkeletonRows cols={9} rows={8} />
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
                      <td className="num">
                        <button className="row-delete" title={`Delete ${c.name}`}
                                aria-label={`Delete ${c.name}`}
                                onClick={() => setPendingDelete(c)}>
                          <Trash2 size={15} />
                        </button>
                      </td>
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

      {pendingDelete && (
        <Modal
          title="Delete this customer?"
          onClose={() => !deleting && setPendingDelete(null)}
          footer={
            <>
              <button className="ghost" disabled={deleting} onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="primary" disabled={deleting} onClick={confirmDelete}
                      style={{ background: "var(--red)", borderColor: "var(--red)" }}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            <strong>{pendingDelete.name}</strong> ({pendingDelete.email}) and their orders and message history will be permanently removed. This can’t be undone.
          </p>
        </Modal>
      )}
    </>
  );
}
