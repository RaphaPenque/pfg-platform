import { useEffect } from "react";
import { Switch, Route, Router, useLocation, Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "./context/AuthContext";
import WorkforceTable from "./pages/WorkforceTable";
import ProjectAllocation from "./pages/ProjectAllocation";
import ProjectHub from "./pages/ProjectHub";
import ProjectHubDetail from "./pages/ProjectHubDetail";
import GanttChart from "./pages/GanttChart";
import PersonSchedule from "./pages/PersonSchedule";
import CustomerPortal from "./pages/CustomerPortal";
import PayrollRules from "./pages/PayrollRules";
import UserManagement from "./pages/UserManagement";
import Login from "./pages/Login";
import ConfirmAssignment from "./pages/ConfirmAssignment";
import MilestoneApprovalPage from "./pages/MilestoneApprovalPage";
import TimesheetApprovalPage from "./pages/TimesheetApprovalPage";
import TimesheetSupervisorPage from "./pages/TimesheetSupervisorPage";
import NotFound from "./pages/not-found";
import { LogOut, Loader2 } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  resource_manager: "Resource Manager",
  project_manager: "Project Manager",
  finance: "Finance",
  observer: "Observer",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "var(--pfg-yellow)",
  resource_manager: "#16a34a",
  project_manager: "#3b82f6",
  finance: "#8b5cf6",
  observer: "#6b7280",
};

const tabs = [
  { id: "workforce", label: "Workforce Table", path: "/" },
  { id: "projects", label: "Project Hub", path: "/projects" },
  { id: "gantt", label: "Gantt Chart", path: "/gantt" },
  { id: "schedule", label: "Person Schedule", path: "/schedule" },
];

function AppHeader() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <>
      <header className="bg-pfg-navy text-white px-6 h-16 flex items-center justify-between sticky top-0 z-50" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
        <div className="flex items-center gap-4">
          <Link href="/">
            <img src="./logo-gold.png" alt="Powerforce Global" className="h-8 cursor-pointer" />
          </Link>
          <span className="text-xs font-medium tracking-[0.12em] uppercase text-white/50 ml-1">
            Workforce Intelligence Platform
          </span>
        </div>
        <div className="flex items-center gap-3">
          {user && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white/90" data-testid="header-user-name">{user.name}</span>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: ROLE_COLORS[user.role] || "#6b7280", color: user.role === "admin" ? "#1A1D23" : "#fff" }}
                  data-testid="header-user-role"
                >
                  {ROLE_LABELS[user.role] || user.role}
                </span>
              </div>
              <button
                onClick={logout}
                className="text-sm text-white/60 hover:text-white flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition"
                data-testid="sign-out-btn"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
            </>
          )}
          <button
            className="text-sm text-white/60 hover:text-white flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition"
            onClick={() => window.print()}
            data-testid="button-print"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print
          </button>
        </div>
      </header>

      <nav className="bg-white border-b flex px-6 gap-0 no-print" style={{ borderColor: "hsl(var(--border))" }}>
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
        {/* Admin-only section divider + Payroll Rules link */}
        {user?.role === "admin" && (
          <>
            <div className="w-px my-2 mx-2" style={{ background: "hsl(var(--border))" }} />
            <Link href="/admin/payroll-rules">
              <div
                className={`px-5 py-3 text-[13px] font-medium cursor-pointer border-b-2 transition-all ${
                  location === "/admin/payroll-rules"
                    ? "text-pfg-navy border-pfg-yellow"
                    : "text-pfg-steel border-transparent hover:text-pfg-navy"
                }`}
                data-testid="tab-payroll-rules"
              >
                ⚙ Payroll Rules
              </div>
            </Link>
            <Link href="/admin/users">
              <div
                className={`px-5 py-3 text-[13px] font-medium cursor-pointer border-b-2 transition-all ${
                  location === "/admin/users"
                    ? "text-pfg-navy border-pfg-yellow"
                    : "text-pfg-steel border-transparent hover:text-pfg-navy"
                }`}
                data-testid="tab-user-management"
              >
                👥 Users
              </div>
            </Link>
          </>
        )}
      </nav>
    </>
  );
}

function MainLayout() {
  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-5 pb-10">
        <Switch>
          <Route path="/" component={WorkforceTable} />
          <Route path="/projects" component={ProjectHub} />
          <Route path="/projects/allocation" component={ProjectAllocation} />
          <Route path="/projects/:code">{(params) => <ProjectHubDetail params={params} />}</Route>
          <Route path="/gantt" component={GanttChart} />
          <Route path="/schedule" component={PersonSchedule} />
          <Route path="/admin/payroll-rules" component={PayrollRules} />
          <Route path="/admin/users" component={UserManagement} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <footer className="text-center py-5 text-xs text-pfg-steel">
        &copy; 2026 PowerForce Global &middot; Workforce Intelligence Platform
      </footer>
    </div>
  );
}

function AuthVerifyRedirect() {
  // Handle magic link verification
  // If we have a token in the URL, call the API to verify it and set the cookie
  const { refetch } = useAuth();
  
  useEffect(() => {
    const hashParams = window.location.hash.split('?')[1];
    const params = new URLSearchParams(hashParams || '');
    const token = params.get('token');
    
    if (token) {
      // Call the API verify endpoint which sets the session cookie
      fetch(`/api/auth/verify?token=${token}`, { credentials: 'include', redirect: 'manual' })
        .then(() => refetch())
        .then(() => { window.location.hash = '/'; })
        .catch(() => { window.location.hash = '/login'; });
    } else {
      // No token — just reload auth (cookie already set by server redirect)
      refetch().then(() => { window.location.hash = '/'; });
    }
  }, []);
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pfg-navy, #1A1D23)" }}>
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: "var(--pfg-yellow)" }} />
        <p className="text-white/70 text-sm">Signing you in...</p>
      </div>
    </div>
  );
}

function AppContent() {
  const [location] = useLocation();
  const { user, isLoading } = useAuth();

  // Public confirmation route (no auth required)
  if (location.startsWith("/confirm/")) {
    const token = location.replace("/confirm/", "");
    return <ConfirmAssignment params={{ token }} />;
  }

  // Portal routes render standalone (no auth required)
  if (location.startsWith("/portal/")) {
    const projectCode = location.replace("/portal/", "");
    return <CustomerPortal params={{ projectCode }} />;
  }

  // Milestone approval — public, no auth required
  if (location.startsWith("/milestone-approval/")) {
    const token = location.replace("/milestone-approval/", "");
    return <MilestoneApprovalPage params={{ token }} />;
  }

  // Timesheet approval — public, no auth required
  if (location.startsWith("/timesheet-approval/")) {
    const token = location.replace("/timesheet-approval/", "");
    return <TimesheetApprovalPage params={{ token }} />;
  }

  // Timesheet supervisor review — public, no auth required
  if (location.startsWith("/timesheet-supervisor/")) {
    const token = location.replace("/timesheet-supervisor/", "");
    return <TimesheetSupervisorPage params={{ token }} />;
  }

  // Auth verify redirect
  if (location.startsWith("/auth/verify")) {
    return <AuthVerifyRedirect />;
  }

  // Login page (no auth)
  if (location === "/login") {
    return <Login />;
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pfg-navy, #1A1D23)" }}>
        <div className="text-center">
          <img src="./logo-gold.png" alt="Powerforce Global" className="h-10 mx-auto mb-4 opacity-50" />
          <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: "var(--pfg-yellow)" }} />
        </div>
      </div>
    );
  }

  // Not authenticated — show login
  if (!user) {
    return <Login />;
  }

  return <MainLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router hook={useHashLocation}>
          <AppContent />
        </Router>
      </AuthProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
