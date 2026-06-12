import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate } from "../api.js";
import RuleEditor, { defaultGroup, humanizeRules } from "../components/RuleEditor.jsx";

export default function Segments({ aiEnabled }) {
  const [segments, setSegments] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  // draft = { name, description, rules, created_by } while building a segment
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const previewSeq = useRef(0);

  const loadSegments = () =>
    api.get("/api/segments").then((r) => setSegments(r.segments)).catch((e) => setError(e.message));

  useEffect(() => {
    loadSegments();
  }, []);

  // Live audience preview: debounce while the user edits rules.
  const rulesJson = draft ? JSON.stringify(draft.rules) : "";
  useEffect(() => {
    if (!draft) return;
    const seq = ++previewSeq.current;
    const t = setTimeout(() => {
      api
        .post("/api/segments/preview", { rules: draft.rules })
        .then((p) => { if (seq === previewSeq.current) { setPreview(p); setError(""); } })
        .catch((e) => { if (seq === previewSeq.current) { setPreview(null); setError(e.message); } });
    }, 350);
    return () => clearTimeout(t);
  }, [rulesJson]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await api.post("/api/ai/segment", { prompt });
      setDraft({
        name: res.name,
        description: res.explanation,
        rules: res.rules,
        created_by: "ai",
      });
      setPreview(res.preview);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.post("/api/segments", draft);
      setDraft(null);
      setPreview(null);
      setPrompt("");
      await loadSegments();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audiences</h1>
          <p>Describe who you want to reach — review the rules and live preview before saving.</p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 0 }}>
        <h2>New audience</h2>
        {aiEnabled ? (
          <div className="row">
            <input
              placeholder='e.g. "high spenders in Mumbai who haven’t ordered in 60 days"'
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && prompt.trim() && !generating && generate()}
            />
            <button className="primary shrink" disabled={!prompt.trim() || generating} onClick={generate}>
              {generating ? "Thinking…" : "✦ Generate with AI"}
            </button>
            <button
              className="shrink"
              onClick={() => { setDraft({ name: "", description: "", rules: defaultGroup(), created_by: "user" }); setPreview(null); }}
            >
              Build manually
            </button>
          </div>
        ) : (
          <div className="row">
            <span className="muted">AI is off (no ANTHROPIC_API_KEY) — build rules manually instead.</span>
            <button
              className="primary shrink"
              onClick={() => { setDraft({ name: "", description: "", rules: defaultGroup(), created_by: "user" }); setPreview(null); }}
            >
              Build manually
            </button>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        {draft && (
          <div style={{ marginTop: 16 }}>
            {draft.description && <p className="muted" style={{ marginTop: 0 }}>✦ {draft.description}</p>}
            <div className="row" style={{ marginBottom: 12 }}>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Audience name</span>
                <input
                  value={draft.name}
                  placeholder="e.g. Lapsed high spenders"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
            </div>

            <RuleEditor group={draft.rules} onChange={(rules) => setDraft({ ...draft, rules })} />

            <div className="row" style={{ marginTop: 14, alignItems: "center" }}>
              <div>
                {preview ? (
                  <div>
                    <span className="preview-count">
                      {preview.count.toLocaleString("en-IN")}
                      <small>customers match</small>
                    </span>
                    {preview.sample.length > 0 && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        e.g. {preview.sample.map((s) => `${s.name} (${s.city || "—"})`).join(" · ")}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="spinner">computing audience…</span>
                )}
              </div>
              <div className="shrink" style={{ display: "flex", gap: 8 }}>
                <button className="ghost" onClick={() => { setDraft(null); setPreview(null); }}>Discard</button>
                <button className="primary" disabled={!draft.name.trim() || saving} onClick={save}>
                  {saving ? "Saving…" : "Save audience"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Saved audiences ({segments.length})</h2>
        {segments.length === 0 ? (
          <p className="muted">Nothing saved yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Rules</th><th>By</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.description && <div className="muted" style={{ fontSize: 12 }}>{s.description}</div>}
                  </td>
                  <td><code style={{ fontSize: 12 }}>{humanizeRules(s.rules)}</code></td>
                  <td>{s.created_by === "ai" ? <span className="badge ai">✦ AI</span> : <span className="badge">user</span>}</td>
                  <td>{fmtDate(s.created_at)}</td>
                  <td>
                    <Link to={`/campaigns/new?segment=${s.id}`}><button>Use →</button></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
