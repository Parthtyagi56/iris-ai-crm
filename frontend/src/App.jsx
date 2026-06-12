import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
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

const ic = {
  dashboard: <path d="M2.5 2.5h4.5v6H2.5zM9.5 2.5h4v3.5h-4zM9.5 8.5h4v5h-4zM2.5 11h4.5v2.5H2.5z" />,
  customers: <><circle cx="5.5" cy="5" r="2.4" /><path d="M1.5 13.5c0-2.2 1.8-4 4-4s4 1.8 4 4" /><circle cx="11" cy="5.5" r="1.8" /><path d="M11.5 9.6c1.7.3 3 1.8 3 3.6" /></>,
  audiences: <><circle cx="8" cy="8" r="5.7" /><circle cx="8" cy="8" r="3" /><circle cx="8" cy="8" r="0.6" fill="currentColor" /></>,
  campaigns: <path d="M13.8 2.2 2.4 6.6l3.8 1.9 1.4 4.3 2.5-3.2 3.7-7.4zM6.2 8.5l7.6-6.3" />,
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"
         strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ic[name]}
    </svg>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/customers", label: "Customers", icon: "customers" },
  { to: "/segments", label: "Audiences", icon: "audiences" },
  { to: "/campaigns", label: "Campaigns", icon: "campaigns" },
];

export default function App() {
  const [ai, setAi] = useState(null);

  useEffect(() => {
    api.get("/api/ai/status").then(setAi).catch(() => setAi({ enabled: false }));
  }, []);

  return (
    <ToastProvider>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">◆</span>Aurelia
            <span className="brand-sub">Shopper engagement</span>
          </div>
          <nav aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                <span className="nav-icon"><Icon name={n.icon} /></span>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div
            className={`ai-pill ${ai?.enabled ? "on" : "off"}`}
            title={ai?.enabled ? `AI features enabled (${ai.model})` : "Set ANTHROPIC_API_KEY in backend/.env to enable AI"}
          >
            {ai === null ? "…" : ai.enabled ? `✦ AI on · ${ai.model}` : "AI off — set ANTHROPIC_API_KEY"}
          </div>
        </aside>
        <main className="content">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/segments" element={<Segments aiEnabled={!!ai?.enabled} />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route path="/campaigns/new" element={<CampaignNew aiEnabled={!!ai?.enabled} />} />
              <Route path="/campaigns/:id" element={<CampaignDetail aiEnabled={!!ai?.enabled} />} />
              <Route
                path="*"
                element={
                  <EmptyState
                    icon="◆"
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
