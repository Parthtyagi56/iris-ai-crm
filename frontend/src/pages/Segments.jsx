import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Target, ArrowRight } from "lucide-react";
import { api, fmtDate } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { useToast } from "../components/Toast.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";
import RuleEditor, { defaultGroup, humanizeRules } from "../components/RuleEditor.jsx";

export default function Segments({ aiEnabled }) {
  usePageTitle("Audiences");
  const toast = useToast();
  const [segments, setSegments] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  // draft = { name, description, rules, created_by } while building an audience
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

  const startManual = () => {
    setDraft({ name: "", description: "", rules: defaultGroup(), created_by: "user" });
    setPreview(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.post("/api/segments", draft);
      toast(`Audience "${draft.name}" saved — ${res.audience_count} customers`, "success");
      setDraft(null);
      setPreview(null);
      setPrompt("");
      await loadSegments();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audiences</h1>
          <p>Describe who you want to reach in plain English. The AI proposes editable rules — you see exactly who matches before anything is saved.</p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 0 }}>
        <h2>New audience</h2>
        {aiEnabled ? (
          <div className="row">
            <input
              aria-label="Describe your audience"
              placeholder='e.g. "high spenders in Mumbai who haven’t ordered in 60 days"'
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && prompt.trim() && !generating && generate()}
            />
            <button className="primary shrink" disabled={!prompt.trim() || generating} onClick={generate}>
              <Sparkles size={14} /> {generating ? "Thinking…" : "Generate with AI"}
            </button>
            <button className="shrink ghost" onClick={startManual}>Build manually</button>
          </div>
        ) : (
          <div className="row">
            <span className="hint">AI is off (no ANTHROPIC_API_KEY) — build rules manually instead.</span>
            <button className="primary shrink" onClick={startManual}>Build manually</button>
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}

        {draft && (
          <div style={{ marginTop: 16 }}>
            {draft.description && (
              <p className="hint" style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 6 }}>
                <Sparkles size={13} /> {draft.description}
              </p>
            )}
            <label className="field" style={{ maxWidth: 420 }}>
              <span>Audience name</span>
              <input
                value={draft.name}
                placeholder="e.g. Lapsed high spenders"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>

            <RuleEditor group={draft.rules} onChange={(rules) => setDraft({ ...draft, rules })} />

            <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
              <div aria-live="polite">
                {preview ? (
                  <div>
                    <span className="preview-count">
                      {preview.count.toLocaleString("en-IN")}
                      <small>customers match right now</small>
                    </span>
                    {preview.sample.length > 0 && (
                      <div className="hint" style={{ marginTop: 4 }}>
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
        <h2>Saved audiences {segments && `(${segments.length})`}</h2>
        {segments === null ? (
          <table><SkeletonRows cols={5} rows={3} /></table>
        ) : segments.length === 0 ? (
          <EmptyState
            icon={<Target size={20} />}
            title="No audiences yet"
            hint="Audiences are reusable, rule-based segments. Campaigns snapshot the rules at launch, so editing an audience later never rewrites history."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Rules</th><th>By</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {segments.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      {s.description && <div className="hint">{s.description}</div>}
                    </td>
                    <td><code className="rules">{humanizeRules(s.rules)}</code></td>
                    <td>{s.created_by === "ai" ? <span className="badge ai"><Sparkles size={11} /> AI</span> : <span className="badge">user</span>}</td>
                    <td className="muted">{fmtDate(s.created_at)}</td>
                    <td>
                      <Link to={`/campaigns/new?segment=${s.id}`}><button>Use <ArrowRight size={14} /></button></Link>
                    </td>
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
