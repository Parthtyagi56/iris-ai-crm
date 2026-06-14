import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  LayoutGrid, Users, Target, Send, Sparkles, Menu, X, SearchX, Plug,
} from "lucide-react";
import { api, API_URL, cachedUser, getModel, setModel } from "./api.js";
import { ToastProvider } from "./components/Toast.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import EmptyState from "./components/EmptyState.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Customers from "./pages/Customers.jsx";
import Segments from "./pages/Segments.jsx";
import Campaigns from "./pages/Campaigns.jsx";
import CampaignNew from "./pages/CampaignNew.jsx";
import CampaignDetail from "./pages/CampaignDetail.jsx";
import DataSources from "./pages/DataSources.jsx";
import Copilot from "./pages/Copilot.jsx";
import Profile from "./pages/Profile.jsx";

// Lyra's mark — a lyre (the constellation's instrument, the Muses' tool).
export function LyraIcon({ size = 16, strokeWidth = 1.6 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
         stroke="currentColor" strokeWidth={strokeWidth}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* two arms flaring up and outward — the lyre's horns */}
      <path d="M10 18C9 13.5 8 9.5 6.5 6.8" />
      <path d="M14 18C15 13.5 16 9.5 17.5 6.8" />
      {/* crossbar across the tips */}
      <path d="M6.8 6.7h10.4" />
      {/* strings */}
      <path d="M9.8 7.7v9" />
      <path d="M12 7.5v9.5" />
      <path d="M14.2 7.7v9" />
      {/* base */}
      <path d="M10 17.9h4" />
    </svg>
  );
}

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", Icon: LayoutGrid, end: true }],
  },
  {
    label: "Engage",
    items: [
      { to: "/copilot", label: "Lyra", Icon: LyraIcon },
      { to: "/segments", label: "Audiences", Icon: Target },
      { to: "/campaigns", label: "Campaigns", Icon: Send },
    ],
  },
  {
    label: "Data",
    items: [
      { to: "/customers", label: "Customers", Icon: Users },
      { to: "/data", label: "Data sources", Icon: Plug },
    ],
  },
];

// Live model picker — lists what the configured provider actually offers,
// stores the choice locally, and api.js sends it as X-AI-Model on every call.
function ModelPicker({ fallback }) {
  const [models, setModels] = useState(null);
  const [value, setValue] = useState(getModel());

  useEffect(() => {
    api.get("/api/ai/models")
      .then((r) => {
        setModels(r.models);
        if (!getModel()) setValue(r.default || fallback);
      })
      .catch(() => setModels([fallback]));
  }, [fallback]);

  const onChange = (e) => { setValue(e.target.value); setModel(e.target.value); };
  const short = (m) => m.split("/").pop();

  return (
    <div className="model-picker">
      <label><Sparkles size={11} /> AI model</label>
      <select value={value || fallback} onChange={onChange} disabled={!models}
              title="Choose the model powering every AI feature">
        {(models || [fallback]).map((m) => (
          <option key={m} value={m}>{short(m)}</option>
        ))}
      </select>
    </div>
  );
}

export default function App() {
  const [ai, setAi] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [me, setMe] = useState(cachedUser());
  const location = useLocation();

  useEffect(() => {
    api.get("/api/ai/status").then(setAi).catch(() => setAi({ enabled: false }));
    const sync = () => setMe(cachedUser());
    window.addEventListener("aurelia:user", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("aurelia:user", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Close the mobile drawer on navigation.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  return (
    <ToastProvider>
      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32" width="30" height="30">
                  <defs>
                    <linearGradient id="brandg" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#1a3a52" />
                      <stop offset="1" stopColor="#1d5e44" />
                    </linearGradient>
                  </defs>
                  <rect width="32" height="32" rx="9" fill="url(#brandg)" />
                  <g fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round">
                    <path d="M7 22a9 9 0 0 1 18 0" />
                    <path d="M10.5 22a5.5 5.5 0 0 1 11 0" />
                    <path d="M14 22a2 2 0 0 1 4 0" />
                  </g>
                </svg>
              </span>
              <span className="brand-text">
                Iris
                <span className="brand-sub">Shopper engagement</span>
              </span>
            </div>
            <button
              className="menu-btn"
              aria-label={navOpen ? "Close menu" : "Open menu"}
              aria-expanded={navOpen}
              onClick={() => setNavOpen((o) => !o)}
            >
              {navOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
          <nav aria-label="Main" className={navOpen ? "open" : ""}>
            {NAV_GROUPS.map((g) => (
              <div key={g.label} className="nav-group">
                <div className="nav-label">{g.label}</div>
                {g.items.map(({ to, label, Icon, end }) => (
                  <NavLink key={to} to={to} end={end}>
                    <span className="nav-icon"><Icon size={16} strokeWidth={2} /></span>
                    {label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <NavLink to="/profile" className="user-chip" title="My profile">
              {me?.avatar_url ? (
                <img src={API_URL + me.avatar_url} alt="" width={28} height={28} />
              ) : (
                <span className="user-chip-initials">
                  {(me?.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
              )}
              <span className="user-chip-text">
                <strong>{me?.name || "Sign in"}</strong>
                <span>{me ? "View profile" : "Workspace account"}</span>
              </span>
            </NavLink>
            {ai?.enabled ? (
              <ModelPicker fallback={ai.model} />
            ) : (
              <div className="ai-pill off" title="Set an AI key in backend/.env to enable AI">
                <Sparkles size={12} />
                {ai === null ? "…" : "AI off — add a key"}
              </div>
            )}
          </div>
        </aside>
        <main className="content">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard aiEnabled={!!ai?.enabled} />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/data" element={<DataSources />} />
              <Route path="/copilot" element={<Copilot aiEnabled={!!ai?.enabled} />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/segments" element={<Segments aiEnabled={!!ai?.enabled} />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route path="/campaigns/new" element={<CampaignNew aiEnabled={!!ai?.enabled} />} />
              <Route path="/campaigns/:id" element={<CampaignDetail aiEnabled={!!ai?.enabled} />} />
              <Route
                path="*"
                element={
                  <EmptyState
                    icon={<SearchX size={22} />}
                    title="Page not found"
                    hint="This route doesn't exist."
                    action={<NavLink to="/"><button>Back to dashboard</button></NavLink>}
                  />
                }
              />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </ToastProvider>
  );
}

export function usePageTitle(title) {
  useEffect(() => {
    document.title = `${title} · Iris`;
    return () => { document.title = "Iris · Shopper engagement"; };
  }, [title]);
}
