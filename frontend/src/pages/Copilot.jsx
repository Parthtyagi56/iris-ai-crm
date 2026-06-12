import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Send as SendIcon, KeyRound, CheckCircle2, Rocket } from "lucide-react";
import { api } from "../api.js";
import { usePageTitle } from "../App.jsx";
import { useToast } from "../components/Toast.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { humanizeRules } from "../components/RuleEditor.jsx";

const STARTERS = [
  "Win back lapsed high spenders before Diwali",
  "Reward my Mumbai VIPs with early access to the new collection",
  "Re-engage one-time buyers with a 10% comeback offer",
];

function PlanCard({ plan, onApprove, approving }) {
  const [variantIdx, setVariantIdx] = useState(0);
  return (
    <div className="plan-card">
      <div className="plan-head">
        <Sparkles size={14} />
        <strong>{plan.campaign_name}</strong>
        <span className="badge channel">{plan.channel}</span>
      </div>

      <div className="plan-row">
        <span className="k">Audience</span>
        <div>
          <strong>{plan.segment_name}</strong>
          {" — "}
          {plan.preview ? (
            <>
              <strong>{plan.preview.count.toLocaleString("en-IN")}</strong> customers match
              {plan.preview.sample?.length > 0 && (
                <span className="hint"> (e.g. {plan.preview.sample.map((s) => s.name).join(", ")})</span>
              )}
            </>
          ) : "preview unavailable"}
          <div><code className="rules">{humanizeRules(plan.rules)}</code></div>
        </div>
      </div>

      {plan.channel_reason && (
        <div className="plan-row"><span className="k">Why {plan.channel}</span><div>{plan.channel_reason}</div></div>
      )}

      <div className="plan-row">
        <span className="k">Message</span>
        <div className="plan-variants">
          {plan.variants.map((v, i) => (
            <label key={i} className={`plan-variant ${i === variantIdx ? "chosen" : ""}`}>
              <input
                type="radio"
                name={`variant-${plan.campaign_name}`}
                checked={i === variantIdx}
                onChange={() => setVariantIdx(i)}
              />
              <div>
                <div className="label">{v.label}</div>
                <p>{v.content}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="plan-actions">
        <span className="hint">
          Draft keeps the launch behind the approval screen; launch executes the plan end to end right now.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={approving} onClick={() => onApprove(plan, variantIdx, false)}>
            <CheckCircle2 size={14} /> Create draft
          </button>
          <button className="primary" disabled={approving} onClick={() => onApprove(plan, variantIdx, true)}>
            <Rocket size={14} />
            {approving ? "Working…" : `Create & launch to ${plan.preview ? plan.preview.count.toLocaleString("en-IN") : "?"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Copilot({ aiEnabled }) {
  usePageTitle("Copilot");
  const toast = useToast();
  const navigate = useNavigate();
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, sending]);

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    const history = [...msgs, { role: "user", content }];
    setMsgs(history);
    setInput("");
    setSending(true);
    try {
      const res = await api.post("/api/ai/chat", {
        messages: history.map(({ role, content }) => ({ role, content })),
      });
      setMsgs([...history, { role: "assistant", content: res.reply, plan: res.plan }]);
    } catch (e) {
      toast(e.message, "error");
      setMsgs(history); // keep the user's message; let them retry
    } finally {
      setSending(false);
    }
  };

  // launch=false: agent stops at a draft (approval modal still guards send).
  // launch=true: the marketer green-lit the plan — execute it end to end.
  const approve = async (plan, variantIdx, launch) => {
    setApproving(true);
    try {
      const seg = await api.post("/api/segments", {
        name: plan.segment_name,
        description: "Proposed by the campaign copilot",
        rules: plan.rules,
        created_by: "ai",
      });
      const camp = await api.post("/api/campaigns", {
        name: plan.campaign_name,
        segment_id: seg.id,
        channel: plan.channel,
        message_template: plan.variants[variantIdx].content,
      });
      if (launch) {
        await api.post(`/api/campaigns/${camp.id}/launch`, {});
        toast(`Launching "${plan.campaign_name}" to ${seg.audience_count} customers`, "success");
      } else {
        toast(`Draft campaign created for ${seg.audience_count} customers`, "success");
      }
      navigate(`/campaigns/${camp.id}`);
    } catch (e) {
      toast(e.message, "error");
      setApproving(false);
    }
  };

  if (!aiEnabled) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Copilot</h1>
            <p>Describe the campaign in plain language — the copilot proposes audience, channel, and copy. You approve.</p>
          </div>
        </div>
        <EmptyState
          icon={<KeyRound size={20} />}
          title="Connect a free AI provider to enable the copilot"
          hint="Grab a free API key from Groq (console.groq.com) or Google AI Studio, then set AI_API_KEY, AI_BASE_URL and AI_MODEL in backend/.env and restart the API. backend/.env.example has copy-paste configs."
        />
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Copilot</h1>
          <p>Describe the goal — the copilot proposes the audience, channel, and message. Nothing sends without your approval.</p>
        </div>
      </div>

      <div className="panel chat-panel" style={{ marginTop: 0 }}>
        <div className="chat-thread">
          {msgs.length === 0 && (
            <div className="starter-wrap">
              <p className="muted">Try one of these, or describe your own goal:</p>
              <div className="starter-chips">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`bubble-row ${m.role}`}>
              <div className="bubble">
                {m.role === "assistant" && <Sparkles size={13} className="bubble-icon" />}
                <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
              </div>
              {m.plan && <PlanCard plan={m.plan} onApprove={approve} approving={approving} />}
            </div>
          ))}
          {sending && (
            <div className="bubble-row assistant">
              <div className="bubble thinking">thinking…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="chat-input">
          <input
            placeholder='e.g. "drive repeat orders in Footwear from active Delhi customers"'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            aria-label="Message the copilot"
          />
          <button className="primary" disabled={!input.trim() || sending} onClick={() => send()}>
            <SendIcon size={14} /> Send
          </button>
        </div>
      </div>
    </>
  );
}
