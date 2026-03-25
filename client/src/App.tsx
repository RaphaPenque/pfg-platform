import { Switch, Route, Router, useLocation, Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useState } from "react";
import WorkforceTable from "./pages/WorkforceTable";
import ProjectAllocation from "./pages/ProjectAllocation";
import GanttChart from "./pages/GanttChart";
import PersonSchedule from "./pages/PersonSchedule";
import CustomerPortal from "./pages/CustomerPortal";
import NotFound from "./pages/not-found";

const tabs = [
  { id: "workforce", label: "Workforce Table", path: "/" },
  { id: "projects", label: "Project Allocation", path: "/projects" },
  { id: "gantt", label: "Gantt Chart", path: "/gantt" },
  { id: "schedule", label: "Person Schedule", path: "/schedule" },
];

function AppHeader() {
  const [location] = useLocation();

  return (
    <>
      {/* Header */}
      <header className="bg-pfg-navy text-white px-6 h-16 flex items-center justify-between sticky top-0 z-50" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
        <div className="flex items-center gap-4">
          <img src="./logo-gold.png" alt="Powerforce Global" className="h-8" />
          <span className="text-xs font-medium tracking-[0.12em] uppercase text-white/50 ml-1">
            Workforce Intelligence Platform
          </span>
        </div>
        <button
          className="text-sm text-white/70 hover:text-white flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition"
          onClick={() => window.print()}
          data-testid="button-print"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print
        </button>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-white border-b flex px-6 gap-0 no-print" style={{ borderColor: 'hsl(var(--border))' }}>
        {tabs.map((tab) => {
          const isActive = location === tab.path || (tab.path === "/" && location === "");
          return (
            <Link key={tab.id} href={tab.path}>
              <div
                className={`px-5 py-3 text-[13px] font-medium cursor-pointer border-b-2 transition-all ${
                  isActive
                    ? "text-pfg-navy border-pfg-yellow"
                    : "text-pfg-steel border-transparent hover:text-pfg-navy"
                }`}
                data-testid={`tab-${tab.id}`}
              >
                {tab.label}
              </div>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function MainLayout() {
  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-5 pb-10">
        <Switch>
          <Route path="/" component={WorkforceTable} />
          <Route path="/projects" component={ProjectAllocation} />
          <Route path="/gantt" component={GanttChart} />
          <Route path="/schedule" component={PersonSchedule} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <footer className="text-center py-5 text-xs text-pfg-steel">
        &copy; 2026 PowerForce Global &middot; Workforce Intelligence Platform &middot;{" "}
        <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="underline hover:text-pfg-navy">
          Created with Perplexity Computer
        </a>
      </footer>
    </div>
  );
}

function AppContent() {
  const [location] = useLocation();

  // Portal routes render standalone (no header/nav)
  if (location.startsWith("/portal/")) {
    const projectCode = location.replace("/portal/", "");
    return <CustomerPortal params={{ projectCode }} />;
  }

  return <MainLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AppContent />
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
