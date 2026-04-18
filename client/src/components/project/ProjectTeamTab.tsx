import { useState, useMemo, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useDashboardData,
  type DashboardProject,
  type DashboardWorker,
  type DashboardAssignment,
} from "@/hooks/use-dashboard-data";
import {
  OEM_OPTIONS,
  PROJECT_CUSTOMER,
  sortSlots,
  cleanName,
  calcUtilisation,
} from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  X,
  Search,
  ChevronDown,
  Loader2,
  Send,
  Mail,
  PhoneCall,
  UserRound,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────

interface AssignPanelState {
  slotId: number;
  slotRole: string;
  slotShift: string;
  slotStartDate: string;
  slotEndDate: string;
  periodStartDate: string;
  periodEndDate: string;
  periodNotes?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────

function datesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string | null,
  bEnd: string | null
): boolean {
  if (!bStart || !bEnd) return false;
  return aStart <= bEnd && aEnd >= bStart;
}

function initials(name: string): string {
  const cleaned = cleanName(name);
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${status === "FTE" ? "badge-navy" : "badge-grey"} text-[10px]`}>
      {status}
    </span>
  );
}

function ShiftBadge({ shift }: { shift: string | null }) {
  if (!shift) return null;
  return (
    <span className={`badge ${shift === "Night" ? "badge-navy" : "badge-accent"} text-[10px]`}>
      {shift}
    </span>
  );
}

function ConfirmationBadge({ assignment }: { assignment: DashboardAssignment }) {
  const status = assignment.status;
  if (status === "confirmed") {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--green-bg)", color: "var(--green)" }}>Confirmed</span>;
  }
  if (status === "pending_confirmation") {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--amber-bg, hsl(var(--accent)))", color: "var(--amber, #D97706)" }}>Pending</span>;
  }
  if (status === "declined") {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--red-bg)", color: "var(--red)" }}>Declined</span>;
  }
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: "#9ca3af" }}>Not sent</span>;
}

// ─── Worker Search Panel (slide-in from right) ──────────────────

function WorkerSearchPanel({
  state,
  onClose,
  onAssigned,
  project,
  allWorkers,
  oemMatch,
}: {
  state: AssignPanelState;
  onClose: () => void;
  onAssigned: () => void;
  project: DashboardProject;
  allWorkers: DashboardWorker[];
  oemMatch: string | null;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [oemFilter, setOemFilter] = useState<string>("");
  const [fteOnly, setFteOnly] = useState(false);
  const [showWarningsOnly, setShowWarningsOnly] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);

  const periodStart = state.periodStartDate;
  const periodEnd = state.periodEndDate;

  interface Enriched {
    worker: DashboardWorker;
    availability: "free" | "partial" | "busy";
    overlapInfo: string;
    utilPct: number;
    hasOemMatch: boolean;
    roleMatch: boolean;
    warnings: string[];
  }

  const enrichedWorkers: Enriched[] = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return allWorkers.map(w => {
      const util = calcUtilisation(w.assignments);
      const hasOemMatch = oemMatch ? w.oemExperience.includes(oemMatch) : true;

      let availability: "free" | "busy" = "free";
      let overlapInfo = "";
      for (const a of w.assignments) {
        if (!(a.status === "active" || a.status === "flagged" || a.status === "confirmed" || a.status === "pending_confirmation")) continue;
        if (a.projectId === project.id) {
          if (datesOverlap(periodStart, periodEnd, a.startDate, a.endDate)) {
            availability = "busy";
            overlapInfo = `Already on this project ${a.startDate}–${a.endDate}`;
            break;
          }
          continue;
        }
        if (datesOverlap(periodStart, periodEnd, a.startDate, a.endDate)) {
          availability = "busy";
          overlapInfo = `On ${a.projectCode} ${a.startDate}–${a.endDate}`;
          break;
        }
      }

      const roleMatch = w.role === state.slotRole;
      const warnings: string[] = [];
      if (!hasOemMatch && oemMatch) warnings.push(`No ${oemMatch} experience`);
      if (!roleMatch) warnings.push(`Role mismatch (${w.role})`);
      if (util.pct > 80) warnings.push(`${util.pct}% utilised YTD`);

      return {
        worker: w,
        availability,
        overlapInfo,
        utilPct: util.pct,
        hasOemMatch,
        roleMatch,
        warnings,
      };
    });
  }, [allWorkers, oemMatch, periodStart, periodEnd, project.id, state.slotRole]);

  const filtered = useMemo(() => {
    let list = enrichedWorkers;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e => e.worker.name.toLowerCase().includes(q) || e.worker.role.toLowerCase().includes(q));
    }
    if (oemFilter) {
      list = list.filter(e => e.worker.oemExperience.some(o => o.startsWith(oemFilter)));
    }
    if (fteOnly) {
      list = list.filter(e => e.worker.status === "FTE");
    }
    if (showWarningsOnly) {
      list = list.filter(e => e.warnings.length === 0);
    }
    // Sort: availability, role match, FTE, OEM, utilisation asc
    return [...list].sort((a, b) => {
      const availOrder = (av: string) => av === "free" ? 0 : av === "partial" ? 1 : 2;
      const d = availOrder(a.availability) - availOrder(b.availability);
      if (d !== 0) return d;
      if (a.roleMatch !== b.roleMatch) return a.roleMatch ? -1 : 1;
      if (a.worker.status !== b.worker.status) return a.worker.status === "FTE" ? -1 : 1;
      if (a.hasOemMatch !== b.hasOemMatch) return a.hasOemMatch ? -1 : 1;
      return a.utilPct - b.utilPct;
    });
  }, [enrichedWorkers, search, oemFilter, fteOnly, showWarningsOnly]);

  const handleAssign = async (workerId: number) => {
    setSaving(workerId);
    try {
      const durationDays = Math.max(
        1,
        Math.ceil((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86400000) + 1
      );
      await apiRequest("POST", "/api/assignments", {
        workerId,
        projectId: project.id,
        roleSlotId: state.slotId,
        role: state.slotRole,
        shift: state.slotShift,
        startDate: periodStart,
        endDate: periodEnd,
        duration: durationDays,
        status: "active",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Worker assigned" });
      onAssigned();
      onClose();
    } catch (e: any) {
      toast({ title: "Error assigning worker", description: e.message || "Unknown error", variant: "destructive" });
    }
    setSaving(null);
  };

  return (
    <div
      className="fixed inset-0 z-[250] flex"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        className="ml-auto h-full flex flex-col"
        style={{
          width: 560,
          maxWidth: "95vw",
          background: "hsl(var(--card))",
          boxShadow: "-8px 0 30px rgba(0,0,0,0.2)",
          animation: "slideInRight 200ms ease-out",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[14px] font-bold text-pfg-navy">Assign Worker</div>
              <div className="text-[12px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>
                {state.slotRole} · {state.slotShift} · {periodStart} → {periodEnd}
              </div>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-black/5 rounded">
              <X className="w-5 h-5" style={{ color: "var(--pfg-steel)" }} />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "hsl(var(--muted-foreground))" }} />
              <input
                type="text"
                placeholder="Search by name or role..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-[12px] rounded-lg border"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
              />
            </div>
          </div>

          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <select
              value={oemFilter}
              onChange={e => setOemFilter(e.target.value)}
              className="text-[11px] px-2 py-1 rounded-lg border"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
            >
              <option value="">All OEMs</option>
              {OEM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <button
              onClick={() => setFteOnly(v => !v)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border"
              style={{
                borderColor: fteOnly ? "var(--pfg-yellow)" : "hsl(var(--border))",
                background: fteOnly ? "hsl(var(--accent))" : "transparent",
                color: fteOnly ? "var(--pfg-navy)" : "var(--pfg-steel)",
              }}
            >
              FTE only
            </button>
            <button
              onClick={() => setShowWarningsOnly(v => !v)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border"
              style={{
                borderColor: showWarningsOnly ? "var(--pfg-yellow)" : "hsl(var(--border))",
                background: showWarningsOnly ? "hsl(var(--accent))" : "transparent",
                color: showWarningsOnly ? "var(--pfg-navy)" : "var(--pfg-steel)",
              }}
            >
              No warnings
            </button>
            <span className="text-[11px] ml-auto" style={{ color: "var(--pfg-steel)" }}>
              {filtered.length} of {allWorkers.length}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
              No matching workers
            </div>
          ) : (
            filtered.map(e => (
              <div
                key={e.worker.id}
                className="flex items-center gap-3 px-5 py-3 border-b cursor-pointer hover:bg-[hsl(var(--accent))]"
                style={{ borderColor: "hsl(var(--border))" }}
                onClick={() => e.availability !== "busy" && handleAssign(e.worker.id)}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{ background: "var(--pfg-navy)", color: "#fff" }}
                >
                  {initials(e.worker.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-pfg-navy truncate">
                    {cleanName(e.worker.name)}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>
                    {e.worker.role} · {e.worker.status === "FTE" ? (e.worker.costCentre || "FTE") : "Temp"}
                  </div>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <StatusBadge status={e.worker.status} />
                    {e.hasOemMatch && oemMatch && (
                      <span className="badge badge-green text-[10px]">OEM ✓</span>
                    )}
                    {e.warnings.map((w, i) => (
                      <span
                        key={i}
                        className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: "var(--amber-bg, #FEF3C7)", color: "var(--amber, #92400E)" }}
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="flex items-center gap-1">
                    <span
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: e.availability === "free" ? "var(--green)" : e.availability === "partial" ? "var(--amber, #D97706)" : "var(--red)",
                      }}
                    />
                    <span
                      className="text-[10px] font-semibold"
                      style={{
                        color: e.availability === "free" ? "var(--green)" : e.availability === "partial" ? "var(--amber, #D97706)" : "var(--red)",
                      }}
                    >
                      {e.availability === "free" ? "Available" : e.availability === "partial" ? "Partial" : "Unavailable"}
                    </span>
                  </div>
                  {e.overlapInfo && (
                    <span className="text-[9px] text-right max-w-[160px]" style={{ color: "var(--pfg-steel)" }}>
                      {e.overlapInfo}
                    </span>
                  )}
                  <span className="text-[10px] tabular-nums" style={{ color: "var(--pfg-steel)" }}>
                    {e.utilPct}% util
                  </span>
                  {e.availability !== "busy" && (
                    <button
                      onClick={(ev) => { ev.stopPropagation(); handleAssign(e.worker.id); }}
                      disabled={saving === e.worker.id}
                      className="text-[10px] font-bold px-2 py-0.5 rounded"
                      style={{ background: "var(--pfg-yellow, #F5BD00)", color: "var(--pfg-navy)" }}
                    >
                      {saving === e.worker.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Assign"}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export default function ProjectTeamTab({
  project,
  onUpdate,
}: {
  project: DashboardProject;
  onUpdate: () => void;
  canEdit?: boolean;
}) {
  const { data } = useDashboardData();
  const allWorkers = data?.workers ?? [];
  const allRoleSlots = data?.roleSlots ?? [];
  const allAssignments = data?.assignments ?? [];
  const { toast } = useToast();

  const customer = project.customer || PROJECT_CUSTOMER[project.code] || "";
  const editOem = OEM_OPTIONS.find(o => customer.includes(o)) || "";
  const editEquipment = project.equipmentType || "";
  const oemMatch = editOem && editEquipment ? `${editOem} - ${editEquipment}` : null;

  const [activeSubTab, setActiveSubTab] = useState<"assignments" | "personnel">("assignments");
  const [expandedSlots, setExpandedSlots] = useState<Set<number>>(new Set());
  const [assignPanel, setAssignPanel] = useState<AssignPanelState | null>(null);
  const [sendingConfirmation, setSendingConfirmation] = useState<number | null>(null);
  const [confirmingManually, setConfirmingManually] = useState<number | null>(null);
  const [sendingAll, setSendingAll] = useState(false);

  const projectSlots = useMemo(
    () => sortSlots(allRoleSlots.filter(s => s.projectId === project.id)),
    [allRoleSlots, project.id]
  );

  const TEAM_STATUSES = ["active", "flagged", "pending_confirmation", "confirmed", "declined"];
  const members = useMemo(() => {
    return allAssignments
      .filter((a: DashboardAssignment) => a.projectId === project.id && TEAM_STATUSES.includes(a.status || ""))
      .map((a: DashboardAssignment) => {
        const worker = allWorkers.find(w => w.id === a.workerId);
        return worker ? { worker, assignment: a } : null;
      })
      .filter(Boolean) as { worker: DashboardWorker; assignment: DashboardAssignment }[];
  }, [allAssignments, allWorkers, project.id]);

  const toggleSlot = (slotId: number) => {
    setExpandedSlots(prev => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  };

  const handleRemove = async (assignmentId: number) => {
    try {
      await apiRequest("DELETE", `/api/assignments/${assignmentId}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Worker removed from project" });
      onUpdate();
    } catch (e: any) {
      toast({ title: "Error removing worker", description: e.message || "Unknown error", variant: "destructive" });
    }
  };

  const handleSendConfirmation = async (assignmentId: number) => {
    setSendingConfirmation(assignmentId);
    try {
      await apiRequest("POST", `/api/assignments/${assignmentId}/send-confirmation`);
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Confirmation request sent" });
      onUpdate();
    } catch (e: any) {
      toast({ title: "Error sending confirmation", description: e.message || "Unknown error", variant: "destructive" });
    }
    setSendingConfirmation(null);
  };

  const handleManualConfirm = async (assignmentId: number) => {
    setConfirmingManually(assignmentId);
    try {
      await apiRequest("POST", `/api/assignments/${assignmentId}/manual-confirm`);
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Confirmed manually" });
      onUpdate();
    } catch (e: any) {
      toast({ title: "Error confirming", description: e.message || "Unknown error", variant: "destructive" });
    }
    setConfirmingManually(null);
  };

  const handleSendAll = async () => {
    setSendingAll(true);
    try {
      const res = await apiRequest("POST", `/api/projects/${project.id}/send-all-confirmations`);
      const result = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: `Sent ${result.sent} confirmation${result.sent !== 1 ? "s" : ""}`, description: result.skipped > 0 ? `${result.skipped} skipped` : undefined });
      onUpdate();
    } catch (e: any) {
      toast({ title: "Error sending confirmations", description: e.message || "Unknown error", variant: "destructive" });
    }
    setSendingAll(false);
  };

  // ── Group slots by shift ──
  const daySlots = projectSlots.filter(s => s.shift !== "Night");
  const nightSlots = projectSlots.filter(s => s.shift === "Night");

  const tempMembers = members.filter(m => m.worker.status === "Temp");
  const tempsAwaiting = tempMembers.filter(
    m => m.assignment.status === "active" || m.assignment.status === "pending_confirmation"
  );

  // ── Active Personnel (today overlap) ──
  const today = new Date().toISOString().split("T")[0];
  const activePersonnel = members.filter(m => {
    const a = m.assignment;
    if (!a.startDate || !a.endDate) return false;
    if (!(a.status === "active" || a.status === "flagged" || a.status === "confirmed")) return false;
    return a.startDate <= today && a.endDate >= today;
  });
  const activeDay = activePersonnel.filter(m => m.assignment.shift !== "Night");
  const activeNight = activePersonnel.filter(m => m.assignment.shift === "Night");

  return (
    <div>
      {assignPanel && (
        <WorkerSearchPanel
          state={assignPanel}
          onClose={() => setAssignPanel(null)}
          onAssigned={() => onUpdate()}
          project={project}
          allWorkers={allWorkers}
          oemMatch={oemMatch}
        />
      )}

      {/* Sub-tabs */}
      <div className="flex items-center border-b mb-5" style={{ borderColor: "hsl(var(--border))" }}>
        <button
          onClick={() => setActiveSubTab("assignments")}
          className="text-[12px] font-semibold px-4 py-2"
          style={{
            color: activeSubTab === "assignments" ? "var(--teal, #005E60)" : "var(--pfg-steel)",
            borderBottom: activeSubTab === "assignments" ? "2px solid var(--teal, #005E60)" : "2px solid transparent",
            marginBottom: -1,
          }}
        >
          Role Assignments
        </button>
        <button
          onClick={() => setActiveSubTab("personnel")}
          className="text-[12px] font-semibold px-4 py-2"
          style={{
            color: activeSubTab === "personnel" ? "var(--teal, #005E60)" : "var(--pfg-steel)",
            borderBottom: activeSubTab === "personnel" ? "2px solid var(--teal, #005E60)" : "2px solid transparent",
            marginBottom: -1,
          }}
        >
          Active Personnel {activePersonnel.length > 0 && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--accent))", color: "#8B6E00" }}>
              {activePersonnel.length}
            </span>
          )}
        </button>
        {tempsAwaiting.length > 0 && activeSubTab === "assignments" && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-medium" style={{ color: "var(--amber, #D97706)" }}>
              {tempsAwaiting.length} Temp{tempsAwaiting.length !== 1 ? "s" : ""} awaiting confirmation
            </span>
            <button
              onClick={handleSendAll}
              disabled={sendingAll}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border"
              style={{ borderColor: "var(--pfg-yellow)", background: "hsl(var(--accent))", color: "var(--pfg-navy)" }}
            >
              {sendingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send to All Temps
            </button>
          </div>
        )}
      </div>

      {/* ─── Role Assignments sub-tab ─── */}
      {activeSubTab === "assignments" && (
        <div>
          {projectSlots.length === 0 ? (
            <div className="text-center py-16 rounded-xl border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
              <div className="text-base font-medium text-pfg-navy mb-2">No role slots defined</div>
              <div className="text-[13px]" style={{ color: "var(--pfg-steel)" }}>
                Go to the Role Planning tab to define role slots first.
              </div>
            </div>
          ) : (
            <>
              {daySlots.length > 0 && (
                <ShiftBlock
                  label="Day Shift"
                  accent="day"
                  slots={daySlots}
                  members={members}
                  allWorkers={allWorkers}
                  expandedSlots={expandedSlots}
                  toggleSlot={toggleSlot}
                  onAssignClick={setAssignPanel}
                  onRemove={handleRemove}
                  onSendConfirmation={handleSendConfirmation}
                  onManualConfirm={handleManualConfirm}
                  sendingConfirmation={sendingConfirmation}
                  confirmingManually={confirmingManually}
                  project={project}
                />
              )}
              {nightSlots.length > 0 && (
                <ShiftBlock
                  label="Night Shift"
                  accent="night"
                  slots={nightSlots}
                  members={members}
                  allWorkers={allWorkers}
                  expandedSlots={expandedSlots}
                  toggleSlot={toggleSlot}
                  onAssignClick={setAssignPanel}
                  onRemove={handleRemove}
                  onSendConfirmation={handleSendConfirmation}
                  onManualConfirm={handleManualConfirm}
                  sendingConfirmation={sendingConfirmation}
                  confirmingManually={confirmingManually}
                  project={project}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* ─── Active Personnel sub-tab ─── */}
      {activeSubTab === "personnel" && (
        <div>
          {activePersonnel.length === 0 ? (
            <div className="text-center py-16 rounded-xl border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
              <div className="text-[13px]" style={{ color: "var(--pfg-steel)" }}>
                No active personnel today.
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {activeDay.length > 0 && <PersonnelTable label="Day Shift" rows={activeDay} />}
              {activeNight.length > 0 && <PersonnelTable label="Night Shift" rows={activeNight} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Shift Block ────────────────────────────────────────────────

function ShiftBlock({
  label,
  accent,
  slots,
  members,
  allWorkers,
  expandedSlots,
  toggleSlot,
  onAssignClick,
  onRemove,
  onSendConfirmation,
  onManualConfirm,
  sendingConfirmation,
  confirmingManually,
  project,
}: {
  label: string;
  accent: "day" | "night";
  slots: any[];
  members: { worker: DashboardWorker; assignment: DashboardAssignment }[];
  allWorkers: DashboardWorker[];
  expandedSlots: Set<number>;
  toggleSlot: (id: number) => void;
  onAssignClick: (state: AssignPanelState) => void;
  onRemove: (assignmentId: number) => void;
  onSendConfirmation: (id: number) => void;
  onManualConfirm: (id: number) => void;
  sendingConfirmation: number | null;
  confirmingManually: number | null;
  project: DashboardProject;
}) {
  const headerBg = accent === "day" ? "#FEF3C7" : "#EDE9FE";
  const headerColor = accent === "day" ? "#92400E" : "#4C1D95";
  const headerBorder = accent === "day" ? "#FDE68A" : "#C4B5FD";
  const dotColor = accent === "day" ? "#D97706" : "#6D28D9";

  return (
    <div className="mb-6">
      <div
        className="flex items-center gap-2 px-4 py-2 rounded-t-lg text-[11px] font-bold uppercase tracking-wider"
        style={{ background: headerBg, color: headerColor, border: `1px solid ${headerBorder}`, borderBottom: "none" }}
      >
        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: dotColor }} />
        {label}
        <span className="ml-auto text-[10px] font-semibold opacity-70">{slots.length} slot{slots.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="border rounded-b-lg overflow-hidden" style={{ borderColor: "hsl(var(--border))", borderTop: "none" }}>
        {slots.map(slot => (
          <SlotCard
            key={slot.id}
            slot={slot}
            members={members}
            allWorkers={allWorkers}
            isExpanded={expandedSlots.has(slot.id)}
            onToggle={() => toggleSlot(slot.id)}
            onAssignClick={onAssignClick}
            onRemove={onRemove}
            onSendConfirmation={onSendConfirmation}
            onManualConfirm={onManualConfirm}
            sendingConfirmation={sendingConfirmation}
            confirmingManually={confirmingManually}
            project={project}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Slot Card ──────────────────────────────────────────────────

function SlotCard({
  slot,
  members,
  allWorkers,
  isExpanded,
  onToggle,
  onAssignClick,
  onRemove,
  onSendConfirmation,
  onManualConfirm,
  sendingConfirmation,
  confirmingManually,
  project,
}: {
  slot: any;
  members: { worker: DashboardWorker; assignment: DashboardAssignment }[];
  allWorkers: DashboardWorker[];
  isExpanded: boolean;
  onToggle: () => void;
  onAssignClick: (state: AssignPanelState) => void;
  onRemove: (id: number) => void;
  onSendConfirmation: (id: number) => void;
  onManualConfirm: (id: number) => void;
  sendingConfirmation: number | null;
  confirmingManually: number | null;
  project: DashboardProject;
}) {
  const slotAssignments = members.filter(m =>
    m.assignment.roleSlotId === slot.id ||
    (!m.assignment.roleSlotId && m.assignment.role === slot.role)
  );

  // Fetch periods lazily when expanded
  const [periods, setPeriods] = useState<any[] | null>(null);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  useEffect(() => {
    if (!isExpanded || periods !== null) return;
    setLoadingPeriods(true);
    apiRequest("GET", `/api/role-slots/${slot.id}/periods`)
      .then(r => r.json())
      .then(data => setPeriods(Array.isArray(data) ? data : []))
      .catch(() => setPeriods([]))
      .finally(() => setLoadingPeriods(false));
  }, [isExpanded, slot.id, periods]);

  const periodsToRender: any[] = (periods && periods.length > 0)
    ? periods
    : [{ id: null, slotId: slot.id, startDate: slot.startDate, endDate: slot.endDate, periodType: "initial", notes: null }];

  function assignmentsForPeriod(p: any) {
    return slotAssignments.filter(m => {
      const a = m.assignment;
      if (!a.startDate || !a.endDate) return false;
      return a.startDate <= p.endDate && a.endDate >= p.startDate;
    });
  }

  const totalAssigned = slotAssignments.filter(m =>
    m.assignment.status === "active" || m.assignment.status === "flagged"
    || m.assignment.status === "confirmed" || m.assignment.status === "pending_confirmation"
  ).length;
  const openSlots = Math.max(0, slot.quantity - totalAssigned);
  const allFilled = openSlots === 0;

  // Mini-Gantt bars
  const miniGantt = buildMiniGantt(slot, periodsToRender, slotAssignments);

  return (
    <div
      className="border-b last:border-b-0"
      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[hsl(var(--muted))]/50"
        onClick={onToggle}
      >
        <div style={{ minWidth: 180 }}>
          <div className="text-[13px] font-bold text-pfg-navy flex items-center gap-1.5">
            {slot.role}
            {slot.quantity > 1 && (
              <span className="text-[10px] font-normal" style={{ color: "var(--pfg-steel)" }}>×{slot.quantity}</span>
            )}
            {openSlots > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-bg, #FEF3C7)", color: "var(--amber, #D97706)" }}>
                {openSlots} open
              </span>
            )}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>
            {slot.quantity} slot{slot.quantity !== 1 ? "s" : ""} · {periodsToRender.length} period{periodsToRender.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Mini-Gantt */}
        <div className="flex-1 relative" style={{ height: 14 }}>
          {miniGantt.map((b, i) => (
            <div
              key={i}
              className="absolute top-0 flex items-center"
              style={{
                left: `${b.leftPct}%`,
                width: `${b.widthPct}%`,
                height: 14,
                background: b.filled ? "var(--teal, #005E60)" : "transparent",
                border: b.filled ? "none" : "1.5px dashed #D1D5DB",
                borderRadius: 3,
                padding: "0 4px",
                overflow: "hidden",
                color: b.filled ? "#fff" : "var(--pfg-steel)",
                fontSize: 8,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
              title={b.label}
            >
              {b.label}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {allFilled ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--green-bg)", color: "var(--green)" }}>
              ✓ Filled
            </span>
          ) : (
            <>
              {totalAssigned > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--green-bg)", color: "var(--green)" }}>
                  {totalAssigned} filled
                </span>
              )}
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--amber-bg, #FEF3C7)", color: "var(--amber, #D97706)" }}>
                {openSlots} open
              </span>
            </>
          )}
        </div>
        <ChevronDown
          className="w-4 h-4 transition-transform"
          style={{ color: "var(--pfg-steel)", transform: isExpanded ? "rotate(180deg)" : undefined }}
        />
      </div>

      {isExpanded && (
        <div style={{ background: "hsl(var(--muted))/0.3", borderTop: "1px solid hsl(var(--border))" }}>
          {loadingPeriods && (
            <div className="px-4 py-3 text-[12px]" style={{ color: "var(--pfg-steel)" }}>
              <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> Loading periods…
            </div>
          )}
          {periodsToRender.map((p: any, pIdx: number) => {
            const periodAssignments = assignmentsForPeriod(p);
            const periodFilled = periodAssignments.length;
            const periodOpen = Math.max(0, slot.quantity - periodFilled);
            const durationDays = Math.max(1, Math.ceil(
              (new Date(p.endDate).getTime() - new Date(p.startDate).getTime()) / 86400000
            ) + 1);
            const bgColor = periodOpen > 0 ? "#FFFBEB" : undefined;

            return (
              <div
                key={p.id ?? `synth-${pIdx}`}
                className="grid items-start gap-4 px-4 py-3 border-b last:border-b-0"
                style={{ gridTemplateColumns: "160px 1fr", borderColor: "#F3F4F6", background: bgColor }}
              >
                <div>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded inline-block"
                    style={{
                      background: p.periodType === "initial" ? "#DBEAFE" : "#DCFCE7",
                      color: p.periodType === "initial" ? "#1D4ED8" : "#166534",
                    }}
                  >
                    {p.periodType === "initial" ? "Initial" : "Remob"}
                  </span>
                  <div className="text-[12px] font-semibold text-pfg-navy mt-1">
                    {p.startDate} → {p.endDate}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>
                    {durationDays} days{p.notes ? ` · ${p.notes}` : ""}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  {periodAssignments.map(m => (
                    <AssignmentChip
                      key={m.assignment.id}
                      member={m}
                      onRemove={onRemove}
                      onSendConfirmation={onSendConfirmation}
                      onManualConfirm={onManualConfirm}
                      sendingConfirmation={sendingConfirmation}
                      confirmingManually={confirmingManually}
                    />
                  ))}
                  {periodOpen > 0 && (
                    <div
                      className="flex items-center gap-2.5 px-3 py-2 rounded-md"
                      style={{ border: "1px dashed #D1D5DB", background: "#FAFBFC" }}
                    >
                      <UserRound className="w-4 h-4" style={{ color: "#9CA3AF" }} />
                      <div className="flex-1">
                        <div className="text-[12px] font-semibold" style={{ color: "var(--pfg-steel)" }}>
                          {periodOpen === 1 ? "No worker assigned" : `${periodOpen} slots unassigned`}
                        </div>
                        <div className="text-[10px]" style={{ color: "#9CA3AF" }}>
                          {p.startDate} – {p.endDate} available
                        </div>
                      </div>
                      <button
                        onClick={() => onAssignClick({
                          slotId: slot.id,
                          slotRole: slot.role,
                          slotShift: slot.shift || "Day",
                          slotStartDate: slot.startDate,
                          slotEndDate: slot.endDate,
                          periodStartDate: p.startDate,
                          periodEndDate: p.endDate,
                          periodNotes: p.notes,
                        })}
                        className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1 rounded-md"
                        style={{ border: "1.5px solid var(--teal, #005E60)", background: "#fff", color: "var(--teal, #005E60)" }}
                      >
                        <Search className="w-3 h-3" />
                        {periodOpen === 1 ? "Assign Worker" : "Assign Workers"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Mini-Gantt ─────────────────────────────────────────────────

function buildMiniGantt(
  slot: any,
  periods: any[],
  slotAssignments: { worker: DashboardWorker; assignment: DashboardAssignment }[]
): { leftPct: number; widthPct: number; filled: boolean; label: string }[] {
  if (!slot.startDate || !slot.endDate) return [];
  const slotStart = new Date(slot.startDate).getTime();
  const slotEnd = new Date(slot.endDate).getTime();
  const range = slotEnd - slotStart || 1;

  return periods.map(p => {
    const pStart = new Date(p.startDate).getTime();
    const pEnd = new Date(p.endDate).getTime();
    const leftPct = Math.max(0, ((pStart - slotStart) / range) * 100);
    const widthPct = Math.max(1, ((pEnd - pStart) / range) * 100);
    const filledWorkers = slotAssignments.filter(m => {
      const a = m.assignment;
      if (!a.startDate || !a.endDate) return false;
      return a.startDate <= p.endDate && a.endDate >= p.startDate
        && (a.status === "active" || a.status === "flagged" || a.status === "confirmed" || a.status === "pending_confirmation");
    });
    const filled = filledWorkers.length > 0;
    const label = filled
      ? (filledWorkers.length === 1 ? cleanName(filledWorkers[0].worker.name) : `${filledWorkers.length} workers`)
      : "Unassigned";
    return { leftPct, widthPct, filled, label };
  });
}

// ─── Assignment Chip ────────────────────────────────────────────

function AssignmentChip({
  member,
  onRemove,
  onSendConfirmation,
  onManualConfirm,
  sendingConfirmation,
  confirmingManually,
}: {
  member: { worker: DashboardWorker; assignment: DashboardAssignment };
  onRemove: (id: number) => void;
  onSendConfirmation: (id: number) => void;
  onManualConfirm: (id: number) => void;
  sendingConfirmation: number | null;
  confirmingManually: number | null;
}) {
  const { worker, assignment } = member;
  const isTemp = worker.status === "Temp";
  const isFlagged = assignment.status === "flagged";

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-white"
      style={{
        border: "1px solid hsl(var(--border))",
        borderLeft: "3px solid var(--teal, #005E60)",
      }}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{ background: "var(--pfg-navy)", color: "#fff" }}
      >
        {initials(worker.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-pfg-navy truncate flex items-center gap-1.5">
          {cleanName(worker.name)}
          {isFlagged && <AlertTriangle className="w-3 h-3" style={{ color: "var(--red)" }} />}
          {worker.driversLicenseUploaded ? (
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold shrink-0"
              style={{ background: "#1A1D23", color: "#F5BD00" }}
              title="Has Driver's Licence"
            >
              D
            </span>
          ) : null}
        </div>
        <div className="text-[10px]" style={{ color: "var(--pfg-steel)" }}>
          {assignment.role || worker.role} · {worker.status}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isTemp && <ConfirmationBadge assignment={assignment} />}
        {isTemp && assignment.status !== "confirmed" && (
          <>
            <button
              onClick={() => onSendConfirmation(assignment.id)}
              disabled={sendingConfirmation === assignment.id}
              className="p-1 rounded hover:bg-black/5"
              title={assignment.status === "pending_confirmation" ? "Resend confirmation" : "Send confirmation request"}
            >
              {sendingConfirmation === assignment.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--pfg-navy)" }} />
              ) : (
                <Mail className="w-3.5 h-3.5" style={{ color: "var(--pfg-navy)" }} />
              )}
            </button>
            <button
              onClick={() => onManualConfirm(assignment.id)}
              disabled={confirmingManually === assignment.id}
              className="p-1 rounded hover:bg-black/5"
              title="Confirm manually (e.g. telephone)"
            >
              {confirmingManually === assignment.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--green)" }} />
              ) : (
                <PhoneCall className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
              )}
            </button>
          </>
        )}
        <button
          onClick={() => onRemove(assignment.id)}
          className="p-1 rounded hover:bg-[var(--red-bg)]"
          title="Remove from project"
        >
          <X className="w-3.5 h-3.5" style={{ color: "var(--pfg-steel)" }} />
        </button>
      </div>
    </div>
  );
}

// ─── Personnel Table (Active Personnel sub-tab) ─────────────────

function PersonnelTable({
  label,
  rows,
}: {
  label: string;
  rows: { worker: DashboardWorker; assignment: DashboardAssignment }[];
}) {
  const today = new Date();

  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: "var(--pfg-steel)" }}>
        {label}
        <span className="flex-1" style={{ height: 1, background: "hsl(var(--border))" }} />
      </div>
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--pfg-navy, #1A1D23)", color: "#fff" }}>
              {["Name", "Role", "MOB Date", "Expected DEMOB", "Days on Site", "Status"].map(h => (
                <th
                  key={h}
                  className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(m => {
              const start = m.assignment.startDate ? new Date(m.assignment.startDate) : null;
              const daysOnSite = start
                ? Math.max(0, Math.ceil((today.getTime() - start.getTime()) / 86400000))
                : 0;
              const hasStarted = start ? today.getTime() >= start.getTime() : false;
              return (
                <tr
                  key={m.assignment.id}
                  className="hover:bg-[hsl(var(--muted))]/50"
                  style={{ borderBottom: "1px solid hsl(var(--border))" }}
                >
                  <td className="px-3 py-2.5 font-semibold text-pfg-navy">
                    {cleanName(m.worker.name)}
                  </td>
                  <td className="px-3 py-2.5">{m.assignment.role || m.worker.role}</td>
                  <td className="px-3 py-2.5">{m.assignment.startDate || "—"}</td>
                  <td className="px-3 py-2.5">{m.assignment.endDate || "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">{hasStarted ? daysOnSite : "—"}</td>
                  <td className="px-3 py-2.5">
                    {hasStarted ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: "var(--green-bg)", color: "var(--green)" }}>
                        Active
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: "#DBEAFE", color: "#1D4ED8" }}>
                        Pending MOB
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
