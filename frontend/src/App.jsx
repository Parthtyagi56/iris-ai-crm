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

const NAV = [
  { to: "/", label: "Dashboard", icon: "▦", end: true },
  { to: "/customers", label: "Customers", icon: "◔" },
  { to: "/segments", label: "Audiences", icon: "◎" },
  { to: "/campaigns", label: "Campaigns", icon: "➤" },
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
            <span className="brand-sub">AI-native mini CRM</span>
          </div>
          <nav aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                <span className="nav-icon" aria-hidden="true">{n.icon}</span>
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
                    icon="∅"
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
    return () => { document.title = "Aurelia · AI-native mini CRM"; };
  }, [title]);
}
