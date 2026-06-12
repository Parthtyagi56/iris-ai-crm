import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  LayoutGrid, Users, Target, Send, Sparkles, Menu, X, SearchX, Plug,
} from "lucide-react";
import { api } from "./api.js";
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

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", Icon: LayoutGrid, end: true }],
  },
  {
    label: "Engage",
    items: [
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

export default function App() {
  const [ai, setAi] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    api.get("/api/ai/status").then(setAi).catch(() => setAi({ enabled: false }));
  }, []);

  // Close the mobile drawer on navigation.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  return (
    <ToastProvider>
      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="brand">
              <span className="brand-mark">◆</span>
              <span className="brand-text">
                Aurelia
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
          <div
            className={`ai-pill ${ai?.enabled ? "on" : "off"}`}
            title={ai?.enabled ? `AI features enabled (${ai.model})` : "Set ANTHROPIC_API_KEY in backend/.env to enable AI"}
          >
            <Sparkles size={12} />
            {ai === null ? "…" : ai.enabled ? `AI on · ${ai.model}` : "AI off — set ANTHROPIC_API_KEY"}
          </div>
        </aside>
        <main className="content">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/data" element={<DataSources />} />
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
    document.title = `${title} · Aurelia`;
    return () => { document.title = "Aurelia · Shopper engagement"; };
  }, [title]);
}
