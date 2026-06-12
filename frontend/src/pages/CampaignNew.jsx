import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { humanizeRules } from "../components/RuleEditor.jsx";

const TOKENS = ["{{first_name}}", "{{name}}", "{{city}}"];
const CHANNELS = ["whatsapp", "sms", "email"];

export default function CampaignNew({ aiEnabled }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [segments, setSegments] = useState(null);
  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState(params.get("segment") || "");
  const [channel, setChannel] = useState("whatsapp");
  const [template, setTemplate] = useState("");
  const [audience, setAudience] = useState(null);

  const [objective, setObjective] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [variants, setVariants] = useState([]);

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const templateRef = useRef(null);

  useEffect(() => {
    api.get("/api/segments").then((r) => {
      setSegments(r.segments);
      // Preselect the only/linked segment for a one-less-click flow.
      if (!params.get("segment") && r.segments.length === 1) setSegmentId(r.segments[0].id);
    }).catch((e) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const segment = useMemo(
    () => segments?.find((s) => s.id === segmentId),
    [segments, segmentId]
  );

  // Audience size for the selected segment, via the same preview endpoint
  // the audience builder uses (rules are data, so this is free).
  useEffect(() => {
    setAudience(null);
    if (!segment) return;
    api.post("/api/segments/preview", { rules: segment.rules })
      .then((p) => setAudience(p.count))
      .catch(() => {});
  }, [segment]);

  const draftWithAI = async () => {
    setDrafting(true);
    setError("");
    try {
      const res = await api.post("/api/ai/draft", {
        objective: objective || name || "Re-engage this audience",
        audience_description: segment?.description || segment?.name || "",
        channel,
      });
      setVariants(res.variants || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setDrafting(false);
    }
  };

  const insertToken = (tok) => {
    const el = templateRef.current;
    if (!el) return setTemplate(template + tok);
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    setTemplate(template.slice(0, start) + tok + template.slice(end));
  };

  const create = async (launch) => {
    setSubmitting(true);
    setError("");
    try {
      const res = await api.post("/api/campaigns", {
        name,
        segment_id: segmentId,
        channel,
        message_template: template,
      });
      if (launch) await api.post(`/api/campaigns/${res.id}/launch`, {});
      navigate(`/campaigns/${res.id}`);
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const ready = name.trim() && segmentId && template.trim();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>New campaign</h1>
          <p>Pick an audience, write (or AI-draft) the message, launch when it looks right.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel" style={{ marginTop: 0 }}>
        <div className="row">
          <label className="field">
            <span>Campaign name</span>
            <input value={name} placeholder="e.g. June win-back" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Audience</span>
            <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
              <option value="">— choose —</option>
              {segments?.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Channel</span>
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        {segments !== null && segments.length === 0 && (
          <p className="muted">
            No audiences yet — <Link to="/segments">create one first</Link>.
          </p>
        )}

        {segment && (
          <p className="muted" style={{ marginTop: 0 }}>
            <code style={{ fontSize: 12 }}>{humanizeRules(segment.rules)}</code>
            {" · "}
            {audience === null ? "counting…" : <strong>{audience.toLocaleString("en-IN")} customers</strong>}
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Message</h2>

        {aiEnabled && (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <input
                placeholder='Objective, e.g. "bring lapsed customers back with 10% off"'
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
              />
              <button className="shrink" disabled={drafting} onClick={draftWithAI}>
                {drafting ? "Drafting…" : "✦ Draft with AI"}
              </button>
            </div>
            {variants.length > 0 && (
              <div className="variants" style={{ marginBottom: 14 }}>
                {variants.map((v, i) => (
                  <div key={i} className="variant">
                    <span className="label">✦ {v.label}</span>
                    <p>{v.content}</p>
                    <button onClick={() => setTemplate(v.content)}>Use this</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <label className="field">
          <span>Template — tokens are personalised per recipient at send time</span>
          <textarea
            ref={templateRef}
            rows={4}
            value={template}
            placeholder="Hi {{first_name}}, we miss you! Here's 10% off your next order."
            onChange={(e) => setTemplate(e.target.value)}
          />
        </label>
        <div className="token-chips">
          {TOKENS.map((t) => (
            <button key={t} onClick={() => insertToken(t)}>{t}</button>
          ))}
        </div>

        <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
          <div className="shrink" style={{ display: "flex", gap: 8 }}>
            <button disabled={!ready || submitting} onClick={() => create(false)}>Save draft</button>
            <button className="primary" disabled={!ready || submitting} onClick={() => create(true)}>
              {submitting ? "Working…" : "Create & launch 🚀"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
