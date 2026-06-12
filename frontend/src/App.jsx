import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api } from "./api.js";
import Dashboard from "./pages/Dashboard.jsx";
import Customers from "./pages/Customers.jsx";
import Segments from "./pages/Segments.jsx";
import Campaigns from "./pages/Campaigns.jsx";
import CampaignNew from "./pages/CampaignNew.jsx";
import CampaignDetail from "./pages/CampaignDetail.jsx";

export default function App() {
  const [ai, setAi] = useState(null);

  useEffect(() => {
    api.get("/api/ai/status").then(setAi).catch(() => setAi({ enabled: false }));
  }, []);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◆</span> Aurelia
          <span className="brand-sub">mini CRM</span>
        </div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/customers">Customers</NavLink>
          <NavLink to="/segments">Audiences</NavLink>
          <NavLink to="/campaigns">Campaigns</NavLink>
        </nav>
        <div className={`ai-pill ${ai?.enabled ? "on" : "off"}`}>
          {ai === null ? "…" : ai.enabled ? `AI on · ${ai.model}` : "AI off — set ANTHROPIC_API_KEY"}
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/segments" element={<Segments aiEnabled={!!ai?.enabled} />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/new" element={<CampaignNew aiEnabled={!!ai?.enabled} />} />
          <Route path="/campaigns/:id" element={<CampaignDetail aiEnabled={!!ai?.enabled} />} />
        </Routes>
      </main>
    </div>
  );
}
