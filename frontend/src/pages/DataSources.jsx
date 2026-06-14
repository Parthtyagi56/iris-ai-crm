import { useRef, useState } from "react";
import {
  Code2, FileSpreadsheet, Plug, CheckCircle2, ShoppingCart, Store,
  Database, Sheet, Megaphone, CreditCard, MessageSquareText, Camera,
  Sparkles,
} from "lucide-react";
import { api, API_URL } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { useToast } from "../components/Toast.jsx";
import Modal from "../components/Modal.jsx";

// Minimal CSV parser: quoted fields, escaped quotes, CRLF.
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

const SCHEMAS = {
  customers: {
    endpoint: "/api/customers/bulk",
    required: ["name", "email"],
    optional: ["phone", "city"],
    toPayload: (r) => ({ name: r.name, email: r.email, phone: r.phone || "", city: r.city || "" }),
    summarize: (res) => `${res.created} created, ${res.skipped_existing} already existed`,
  },
  orders: {
    endpoint: "/api/orders/bulk",
    required: ["customer_email", "amount"],
    optional: ["category", "created_at"],
    toPayload: (r) => ({
      customer_email: r.customer_email,
      amount: Number(r.amount),
      category: r.category || "",
      ...(r.created_at ? { created_at: r.created_at } : {}),
    }),
    summarize: (res) => `${res.created} created, ${res.unknown_customer} unknown customers skipped`,
  },
};

// The sources a retail/D2C brand on Xeno actually runs on — e-commerce
// platforms, retail POS, and the WhatsApp/Instagram/Meta/Google channels
// Xeno engages shoppers through. Each works today via REST or CSV.
const CONNECTORS = [
  {
    name: "Shopify", Icon: ShoppingCart, via: "orders webhook → REST", csvKind: "orders",
    steps: ["In Shopify Admin go to Orders → Export → CSV (plain CSV).",
            "Rename columns to customer_email, amount, category (optional), created_at (optional).",
            "Import the file below — or point an order-created webhook bridge at the API."],
  },
  {
    name: "WooCommerce", Icon: Store, via: "REST or CSV export", csvKind: "orders",
    steps: ["Use any order-export plugin (or WP All Export) to download orders as CSV.",
            "Map columns to customer_email, amount, category, created_at.",
            "Import below, or script the WooCommerce REST API into the bulk endpoint."],
  },
  {
    name: "Retail POS", Icon: CreditCard, via: "billing export → REST", csvKind: "orders",
    steps: ["Export bills/transactions from your POS (GoFrugal, Posist, Shopify POS…).",
            "Keep the buyer email/phone and the bill total as customer_email and amount.",
            "Import the file below — or schedule a nightly push to the API."],
  },
  {
    name: "WhatsApp Business", Icon: MessageSquareText, via: "opt-ins → REST", csvKind: "customers",
    steps: ["Export opted-in contacts from your WhatsApp Business / BSP panel.",
            "Map name and phone (email if available) to the customer fields.",
            "Import below to build a reachable WhatsApp audience."],
  },
  {
    name: "Instagram", Icon: Camera, via: "leads / followers CSV", csvKind: "customers",
    steps: ["Export leads from Instagram lead forms or your social tool.",
            "Map full_name → name and email → email.",
            "Import the file below as customers."],
  },
  {
    name: "Meta Ads", Icon: Megaphone, via: "lead ads CSV / API", csvKind: "customers",
    steps: ["Meta Ads Manager → Lead forms → Download leads (CSV).",
            "Map full_name → name and email → email.",
            "Import the file below to add the leads as customers."],
  },
  {
    name: "Google Sheets", Icon: Sheet, via: "CSV download", csvKind: "customers",
    steps: ["File → Download → Comma separated values (.csv).",
            "Header row: name,email,phone,city.",
            "Import the file below."],
  },
  {
    name: "Data warehouse", Icon: Database, via: "reverse-ETL → REST", csvKind: "customers",
    steps: ["Write a SELECT for the customers (or orders) you want synced.",
            "Schedule a reverse-ETL job (Hightouch/Census or a cron script) that POSTs rows to the bulk endpoint in 500-row chunks.",
            "Re-running is safe — customers dedupe on email."],
  },
];

export default function DataSources() {
  usePageTitle("Data sources");
  const toast = useToast();
  const fileRef = useRef(null);
  const [kind, setKind] = useState("customers");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]); // array of objects keyed by header
  const [problem, setProblem] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState("");
  const [connecting, setConnecting] = useState(null); // connector for modal
  const csvCardRef = useRef(null);

  const schema = SCHEMAS[kind];

  const startCsvImport = (connector) => {
    setKind(connector.csvKind);
    setHeaders([]); setRows([]); setFileName(""); setProblem(""); setSummary("");
    setConnecting(null);
    csvCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    toast(`Import type set to ${connector.csvKind} for ${connector.name}`, "info");
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setSummary("");
    setProblem("");
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length < 2) {
      setProblem("File needs a header row plus at least one data row.");
      setHeaders([]); setRows([]); setFileName(file.name);
      return;
    }
    const hdrs = parsed[0].map((h) => h.trim().toLowerCase());
    const missing = schema.required.filter((r) => !hdrs.includes(r));
    if (missing.length) {
      setProblem(`Missing required column(s): ${missing.join(", ")}. Expected header: ${[...schema.required, ...schema.optional].join(",")}`);
      setHeaders([]); setRows([]); setFileName(file.name);
      return;
    }
    const objs = parsed.slice(1).map((cells) =>
      Object.fromEntries(hdrs.map((h, i) => [h, (cells[i] ?? "").trim()])));
    setHeaders(hdrs);
    setRows(objs);
    setFileName(file.name);
  };

  const runImport = async () => {
    setImporting(true);
    setSummary("");
    try {
      // Chunk so a big file doesn't become one giant request.
      const totals = {};
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500).map(schema.toPayload);
        const res = await api.post(schema.endpoint, batch);
        for (const [k, v] of Object.entries(res)) totals[k] = (totals[k] || 0) + v;
      }
      const text = schema.summarize(totals);
      setSummary(`${rows.length} rows processed — ${text}.`);
      toast(`Import done: ${text}`, "success");
      setHeaders([]); setRows([]); setFileName("");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setImporting(false);
    }
  };

  const expectedHeader = [...schema.required, ...schema.optional].join(",");

  return (
    <>
      <div className="page-head rise">
        <div>
          <h1>Data sources</h1>
          <p>
            Iris is API-first: anything that can POST JSON or export a CSV can feed it today.
            Native one-click connectors are the documented next step, not a prerequisite.
          </p>
        </div>
      </div>

      <div className="methods">
        <div className="panel method-card rise" style={{ marginTop: 0, "--i": 1 }}>
          <h3><Code2 size={16} /> REST ingestion APIs <span className="status-chip">Live</span></h3>
          <p>
            Idempotent bulk endpoints — customers dedupe on email, orders resolve
            <code className="rules" style={{ margin: "0 4px" }}>customer_email</code>
            and report unknowns. This is the path a platform like Shopify or a CDP pushes through.
          </p>
          <div className="code-block">
{`POST ${API_URL}/api/customers/bulk
[{"name":"Asha Mehta","email":"asha@example.com",
  "phone":"+91…","city":"Mumbai"}]

POST ${API_URL}/api/orders/bulk
[{"customer_email":"asha@example.com","amount":2499}]`}
          </div>
          <p style={{ marginBottom: 0 }}>
            Full interactive docs at <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer">{API_URL.replace(/^https?:\/\//, "")}/docs</a>.
          </p>
        </div>

        <div className="panel method-card feature rise" ref={csvCardRef} style={{ marginTop: 0, "--i": 2 }}>
          <h3><FileSpreadsheet size={16} /> CSV import <span className="status-chip">Live · try it</span></h3>
          <p>
            The universal adapter — every commerce tool exports CSV. Header row required:
            <code className="rules" style={{ marginLeft: 4 }}>{expectedHeader}</code>
          </p>
          <div className="row">
            <label className="field" style={{ marginBottom: 0, maxWidth: 160 }}>
              <span>Import type</span>
              <select value={kind} onChange={(e) => { setKind(e.target.value); setHeaders([]); setRows([]); setFileName(""); setProblem(""); setSummary(""); }}>
                <option value="customers">Customers</option>
                <option value="orders">Orders</option>
              </select>
            </label>
            <div className="shrink">
              <button onClick={() => fileRef.current?.click()}>
                <FileSpreadsheet size={14} /> {fileName ? "Choose another file" : "Choose CSV file"}
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} aria-label="CSV file" />
            </div>
          </div>

          {problem && <div className="error-banner">{problem}</div>}

          {rows.length > 0 && (
            <div className="csv-preview">
              <div className="hint" style={{ marginBottom: 6 }}>
                {fileName} — {rows.length.toLocaleString("en-IN")} rows. Preview:
              </div>
              <div className="table-wrap" style={{ maxHeight: 180 }}>
                <table className="mini">
                  <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>{headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
                <button className="primary shrink" disabled={importing} onClick={runImport}>
                  {importing ? "Importing…" : `Import ${rows.length.toLocaleString("en-IN")} ${kind}`}
                </button>
              </div>
            </div>
          )}

          {summary && <div className="import-summary"><CheckCircle2 size={15} /> {summary}</div>}
        </div>
      </div>

      <div className="panel rise" style={{ "--i": 3 }}>
        <h2><Plug size={15} /> Where your data lives today</h2>
        <p className="panel-sub">
          Every source below works right now through the two live paths above. A native OAuth
          connector per tile is the roadmap — the ingest contract they'd target already exists.
        </p>
        <div className="connector-grid">
          {CONNECTORS.map((c) => (
            <button
              key={c.name}
              type="button"
              className="connector-tile"
              onClick={() => setConnecting(c)}
              aria-label={`Connect ${c.name}`}
            >
              <c.Icon size={18} />
              <span className="name">{c.name}</span>
              <span className="via">{c.via}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel rise" style={{ "--i": 4 }}>
        <h2><Sparkles size={15} /> Agent access · MCP</h2>
        <p className="panel-sub">
          Iris ships an <strong>MCP server</strong> so an AI agent (Claude Desktop, or any
          MCP client) can operate the CRM by conversation — explore the base, build an
          audience, draft copy, launch a campaign, read the funnel. Same HTTP API, same
          human-approval boundary (draft vs. launch).
        </p>
        <div className="code-block">
{`// claude_desktop_config.json
{
  "mcpServers": {
    "iris-crm": {
      "command": "python",
      "args": ["mcp-server/server.py"],
      "env": { "CRM_BASE_URL": "${API_URL}" }
    }
  }
}`}
        </div>
      </div>

      {connecting && (
        <Modal
          title={`Connect ${connecting.name}`}
          onClose={() => setConnecting(null)}
          footer={
            <>
              <button className="ghost" onClick={() => setConnecting(null)}>Close</button>
              <button className="primary" onClick={() => startCsvImport(connecting)}>
                <FileSpreadsheet size={14} /> Import {connecting.csvKind} CSV now
              </button>
            </>
          }
        >
          <ol className="connect-steps">
            {connecting.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <p className="hint" style={{ marginBottom: 6 }}>
            Prefer pushing directly? Point {connecting.name} (or a small bridge script) at:
          </p>
          <div className="code-block">
{`POST ${API_URL}${SCHEMAS[connecting.csvKind].endpoint}
Content-Type: application/json

${connecting.csvKind === "orders"
  ? '[{"customer_email":"asha@example.com","amount":2499,\n  "category":"Dresses"}]'
  : '[{"name":"Asha Mehta","email":"asha@example.com",\n  "phone":"+91…","city":"Mumbai"}]'}`}
          </div>
        </Modal>
      )}
    </>
  );
}
