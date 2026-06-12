import { X } from "lucide-react";

// Recursive editor for the backend's segment rule DSL:
//   { op: "and"|"or", conditions: [ {field, cmp, value} | nested group ] }
// Mirrors the whitelist in backend/app/schemas.py — only these fields and
// comparators compile server-side.

export const FIELDS = [
  { id: "total_spend", label: "Total spend (₹)", numeric: true },
  { id: "order_count", label: "Order count", numeric: true },
  { id: "avg_order_value", label: "Avg order value (₹)", numeric: true },
  { id: "days_since_last_order", label: "Days since last order", numeric: true },
  { id: "days_since_joined", label: "Days since joined", numeric: true },
  { id: "city", label: "City", numeric: false },
];
const COMPARATORS = [">", ">=", "<", "<=", "==", "!=", "in"];

const isGroup = (node) => node && typeof node === "object" && "op" in node;
const fieldMeta = (id) => FIELDS.find((f) => f.id === id) || FIELDS[0];

export const defaultCondition = () => ({ field: "total_spend", cmp: ">=", value: 5000 });
export const defaultGroup = () => ({ op: "and", conditions: [defaultCondition()] });

// Display value as editable text; parse back on change.
function valueToText(value) {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function parseValue(text, field, cmp) {
  const meta = fieldMeta(field);
  if (cmp === "in") {
    return text.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (meta.numeric) {
    const n = Number(text);
    return Number.isFinite(n) ? n : 0;
  }
  return text;
}

function ConditionRow({ cond, onChange, onRemove }) {
  const meta = fieldMeta(cond.field);
  const set = (patch) => {
    const next = { ...cond, ...patch };
    // Re-coerce the value when field/comparator type changes.
    next.value = parseValue(valueToText(next.value), next.field, next.cmp);
    onChange(next);
  };
  return (
    <div className="condition">
      <select value={cond.field} onChange={(e) => set({ field: e.target.value })}>
        {FIELDS.map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </select>
      <select value={cond.cmp} onChange={(e) => set({ cmp: e.target.value })}>
        {COMPARATORS.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <input
        value={valueToText(cond.value)}
        placeholder={cond.cmp === "in" ? "Mumbai, Delhi" : meta.numeric ? "5000" : "Mumbai"}
        onChange={(e) => onChange({ ...cond, value: parseValue(e.target.value, cond.field, cond.cmp) })}
      />
      <button className="danger-ghost" title="Remove condition" aria-label="Remove condition" onClick={onRemove}><X size={14} /></button>
    </div>
  );
}

export default function RuleEditor({ group, onChange, depth = 0 }) {
  const setConditions = (conditions) => onChange({ ...group, conditions });
  const removeAt = (i) => setConditions(group.conditions.filter((_, j) => j !== i));
  const updateAt = (i, node) =>
    node === null
      ? removeAt(i) // nested group asked to remove itself
      : setConditions(group.conditions.map((c, j) => (j === i ? node : c)));

  return (
    <div className="rule-group">
      <div className="group-head">
        <span className="op-toggle">
          {["and", "or"].map((op) => (
            <button
              key={op}
              className={group.op === op ? "active" : ""}
              onClick={() => onChange({ ...group, op })}
            >
              {op.toUpperCase()}
            </button>
          ))}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          {group.op === "and" ? "all conditions must match" : "any condition matches"}
        </span>
      </div>

      {group.conditions.map((node, i) =>
        isGroup(node) ? (
          <RuleEditor key={i} group={node} depth={depth + 1} onChange={(g) => updateAt(i, g)} />
        ) : (
          <ConditionRow key={i} cond={node} onChange={(c) => updateAt(i, c)} onRemove={() => removeAt(i)} />
        )
      )}

      <div className="rule-actions">
        <button onClick={() => setConditions([...group.conditions, defaultCondition()])}>
          + condition
        </button>
        {depth < 1 && (
          <button onClick={() => setConditions([...group.conditions, defaultGroup()])}>
            + nested group
          </button>
        )}
        {depth > 0 && (
          <button className="danger-ghost" onClick={() => onChange(null)}>
            remove group
          </button>
        )}
      </div>
    </div>
  );
}

// "total_spend >= 5000 AND (city in [Mumbai, Delhi])" — for list views.
export function humanizeRules(node) {
  if (!node) return "";
  if (isGroup(node)) {
    const parts = node.conditions.map((c) =>
      isGroup(c) ? `(${humanizeRules(c)})` : humanizeRules(c)
    );
    return parts.join(` ${node.op.toUpperCase()} `);
  }
  const v = Array.isArray(node.value) ? `[${node.value.join(", ")}]` : node.value;
  return `${node.field} ${node.cmp} ${v}`;
}
