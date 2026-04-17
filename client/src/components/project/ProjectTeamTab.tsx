import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useDashboardData,
  type DashboardProject,
  type DashboardWorker,
  type DashboardAssignment,
  type DashboardRoleSlot,
} from "@/hooks/use-dashboard-data";
import {
  OEM_OPTIONS,
  PROJECT_CUSTOMER,
  PROJECT_ROLES,
  COST_CENTRES,
  CERT_DEFS,
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
  ChevronUp,
  Info,
  Undo2,
  Loader2,
  Send,
  Mail,
  PhoneCall,
  CalendarDays,
  Trash2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

// ─── Types ──────────────────────────────────────────────────────

interface RoleSlotDraft {
  key: number;
  role: string;
  startDate: string;
  endDate: string;
  quantity: number;
  shift: string;
}

// ─── Small shared components ────────────────────────────────────

function ShiftBadge({ shift }: { shift: string | null }) {
  if (!shift) return null;
  return (
    <span
      className={`badge ${shift === "Night" ? "badge-navy" : "badge-accent"}`}
    >
      {shift}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${status === "FTE" ? "badge-navy" : "badge-grey"}`}
    >
      {status}
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
  // "active" temp with no token sent yet
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: "#9ca3af" }}>Not sent</span>;
}

const inputStyle = {
  borderColor: "hsl(var(--border))",
  background: "hsl(var(--card))",
};

function TeamMultiSelect({
  label, options, selected, onChange,
}: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter(s => s !== val) : [...selected, val]);
  };

  const display = selected.length === 0 ? label : selected.length === 1 ? selected[0] : `${selected.length} sel.`;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border truncate"
        style={{
          borderColor: selected.length > 0 ? "var(--pfg-yellow)" : "hsl(var(--border))",
          background: selected.length > 0 ? "hsl(var(--accent))" : "transparent",
          color: selected.length > 0 ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
          maxWidth: "130px",
        }}>
        <span className="truncate">{display}</span>
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[180px] max-h-48 overflow-y-auto rounded-lg border p-1"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.1))" }}>
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-2.5 py-1 text-[11px] cursor-pointer rounded hover:bg-black/5">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="accent-[var(--pfg-yellow)]" />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function datesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string | null,
  bEnd: string | null
): boolean {
  if (!bStart || !bEnd) return false;
  return aStart <= bEnd && aEnd >= bStart;
}

function workerIsAvailable(
  worker: DashboardWorker,
  slotStart: string,
  slotEnd: string,
  excludeProjectId?: number
): boolean {
  for (const a of worker.assignments) {
    if (a.status !== "active" && a.status !== "flagged" && a.status !== "confirmed" && a.status !== "pending_confirmation") continue;
    // For same-project assignments: only skip if dates DON'T overlap
    // (worker can be on multiple non-overlapping slots of the same project)
    if (excludeProjectId && a.projectId === excludeProjectId) {
      if (!datesOverlap(slotStart, slotEnd, a.startDate, a.endDate)) continue;
      // Same project but overlapping dates — still unavailable
      return false;
    }
    if (datesOverlap(slotStart, slotEnd, a.startDate, a.endDate)) return false;
  }
  return true;
}

// ─── Main Component ─────────────────────────────────────────────

// ── Periods Manager ───────────────────────────────────────────────────
function PeriodsManager({ assignmentId, onUpdate }: { assignmentId: number; onUpdate: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [addingPeriod, setAddingPeriod] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ startDate: "", endDate: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const { data: periods = [], refetch } = useQuery<any[]>({
    queryKey: [`/api/assignments/${assignmentId}/periods`],
    enabled: open,
  });

  const handleAdd = useCallback(async () => {
    if (!newPeriod.startDate || !newPeriod.endDate) return;
    setSaving(true);
    try {
      await apiRequest("POST", `/api/assignments/${assignmentId}/periods`, {
        ...newPeriod,
        periodType: "remob",
      });
      setNewPeriod({ startDate: "", endDate: "", notes: "" });
      setAddingPeriod(false);
      refetch();
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onUpdate();
      toast({ title: "Period added" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }, [assignmentId, newPeriod, refetch, onUpdate, toast]);

  const handleDelete = useCallback(async (periodId: number) => {
    if (!confirm("Remove this period? The worker will show as available during these dates.")) return;
    try {
      await apiRequest("DELETE", `/api/assignment-periods/${periodId}`);
      refetch();
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onUpdate();
      toast({ title: "Period removed" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  }, [refetch, onUpdate, toast]);

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] font-semibold"
        style={{ color: "var(--pfg-steel)" }}
      >
        <CalendarDays className="w-3.5 h-3.5" />
        Deployment Periods
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 pl-1">
          {periods.map((p: any) => (
            <div key={p.id} className="flex items-center gap-2 text-[11px]">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: p.periodType === "initial" ? "hsl(var(--muted))" : "#fef3c7", color: p.periodType === "initial" ? "var(--pfg-steel)" : "#92400e" }}>
                {p.periodType === "initial" ? "Initial" : "Remob"}
              </span>
              <span style={{ color: "var(--pfg-navy)" }}>{p.startDate} → {p.endDate}</span>
              {p.notes && <span style={{ color: "var(--pfg-steel)" }}>— {p.notes}</span>}
              {p.periodType !== "initial" && (
                <button onClick={() => handleDelete(p.id)} className="ml-auto opacity-50 hover:opacity-100">
                  <Trash2 className="w-3 h-3" style={{ color: "#dc2626" }} />
                </button>
              )}
            </div>
          ))}
          {addingPeriod ? (
            <div className="flex items-center gap-2 mt-1">
              <input type="date" value={newPeriod.startDate} onChange={e => setNewPeriod(p => ({ ...p, startDate: e.target.value }))} className="text-[11px] px-1.5 py-0.5 border rounded" style={{ borderColor: "hsl(var(--border))" }} />
              <span style={{ color: "var(--pfg-steel)" }}>to</span>
              <input type="date" value={newPeriod.endDate} onChange={e => setNewPeriod(p => ({ ...p, endDate: e.target.value }))} className="text-[11px] px-1.5 py-0.5 border rounded" style={{ borderColor: "hsl(var(--border))" }} />
              <input type="text" value={newPeriod.notes} onChange={e => setNewPeriod(p => ({ ...p, notes: e.target.value }))} placeholder="Notes (optional)" className="text-[11px] px-1.5 py-0.5 border rounded flex-1" style={{ borderColor: "hsl(var(--border))" }} />
              <button onClick={handleAdd} disabled={saving || !newPeriod.startDate || !newPeriod.endDate} className="text-[11px] font-semibold px-2 py-0.5 rounded disabled:opacity-50" style={{ background: "var(--pfg-navy)", color: "#fff" }}>
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
              </button>
              <button onClick={() => setAddingPeriod(false)} className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingPeriod(true)}
              className="flex items-center gap-1 text-[11px] font-semibold mt-1"
              style={{ color: "var(--pfg-teal, #005E60)" }}
            >
              <Plus className="w-3 h-3" /> Add Remob Period
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectTeamTab({
  project,
  onUpdate,
}: {
  project: DashboardProject;
  onUpdate: () => void;
}) {
  const { data } = useDashboardData();
  const allWorkers = data?.workers ?? [];
  const allRoleSlots = data?.roleSlots ?? [];
  const allAssignments = data?.assignments ?? [];
  const { toast } = useToast();

  const customer =
    project.customer || PROJECT_CUSTOMER[project.code] || "";
  const editOem =
    OEM_OPTIONS.find((o) => customer.includes(o)) || "";
  const editEquipment = project.equipmentType || "";

  const TEAM_STATUSES = ["active", "flagged", "pending_confirmation", "confirmed", "declined"];

  // Build members array from dashboard data
  const members = useMemo(() => {
    return allAssignments
      .filter(
        (a: DashboardAssignment) =>
          a.projectId === project.id &&
          TEAM_STATUSES.includes(a.status || "")
      )
      .map((a: DashboardAssignment) => {
        const worker = allWorkers.find((w) => w.id === a.workerId);
        return worker ? { worker, assignment: a } : null;
      })
      .filter(Boolean) as {
      worker: DashboardWorker;
      assignment: DashboardAssignment;
    }[];
  }, [allAssignments, allWorkers, project.id]);

  // Build role slot drafts from existing server data
  const existingSlots = useMemo(
    () => allRoleSlots.filter((s) => s.projectId === project.id),
    [allRoleSlots, project.id]
  );
  const roleSlotEdits: RoleSlotDraft[] = useMemo(
    () =>
      existingSlots.map((s) => ({
        key: -(s.id),
        role: s.role,
        startDate: s.startDate,
        endDate: s.endDate,
        quantity: s.quantity,
        shift: s.shift || "Day",
      })),
    [existingSlots]
  );

  // ── Team tab state ──
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [slotAdditions, setSlotAdditions] = useState<
    Record<number, number[]>
  >({});
  const [editSlotSearch, setEditSlotSearch] = useState<
    Record<number, string>
  >({});
  const [editSlotFteOnly, setEditSlotFteOnly] = useState<
    Record<number, boolean>
  >({});
  const [editSlotRoleFilter, setEditSlotRoleFilter] = useState<Record<number, string[]>>({});
  const [editSlotCostCentreFilter, setEditSlotCostCentreFilter] = useState<Record<number, string[]>>({});
  const [editSlotOemFilter, setEditSlotOemFilter] = useState<Record<number, string[]>>({});
  const [editSlotCertFilter, setEditSlotCertFilter] = useState<Record<number, string[]>>({});
  const [editExpandedWorkers, setEditExpandedWorkers] = useState<
    Set<number>
  >(new Set());
  const [saving, setSaving] = useState(false);
  const [sendingConfirmation, setSendingConfirmation] = useState<number | null>(null);
  const [confirmingManually, setConfirmingManually] = useState<number | null>(null);
  const [sendingAll, setSendingAll] = useState(false);

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

  const handleSendAllConfirmations = async () => {
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

  const handleRemove = async (assignmentId: number) => {
    try {
      await apiRequest("DELETE", `/api/assignments/${assignmentId}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Worker removed from project" });
      onUpdate();
    } catch (e: any) {
      toast({
        title: "Error removing worker",
        description: e.message || "Unknown error",
        variant: "destructive",
      });
    }
  };

  // Get workers assigned to a role slot (existing team members)
  const getSlotMembers = (slotKey: number) => {
    const slotId = slotKey < 0 ? Math.abs(slotKey) : undefined;
    const slot = roleSlotEdits.find((s) => s.key === slotKey);
    if (!slot) return [];
    return members.filter((m) => {
      if (slotId && m.assignment.roleSlotId === slotId) return true;
      if (
        !m.assignment.roleSlotId &&
        slotId &&
        m.assignment.role === slot.role
      )
        return true;
      return false;
    });
  };

  // Get unmatched members
  const unmatchedMembers = useMemo(() => {
    const slotIds = new Set(existingSlots.map((s) => s.id));
    const slotRoles = new Set(roleSlotEdits.map((s) => s.role));
    return members.filter((m) => {
      if (m.assignment.roleSlotId && slotIds.has(m.assignment.roleSlotId))
        return false;
      if (
        !m.assignment.roleSlotId &&
        m.assignment.role &&
        slotRoles.has(m.assignment.role)
      )
        return false;
      return true;
    });
  }, [members, existingSlots, roleSlotEdits]);

  // Available workers for a role slot
  function getEditAvailableWorkers(
    slotKey: number
  ): { filtered: DashboardWorker[]; total: number } {
    const slot = roleSlotEdits.find((s) => s.key === slotKey);
    if (!slot) return { filtered: [], total: 0 };

    // Worker IDs already on the project
    const projectWorkerIds = new Set(members.map((m) => m.worker.id));
    // Worker IDs added in this session across all slots
    const allAddedIds = new Set<number>();
    for (const ids of Object.values(slotAdditions)) {
      for (const id of ids) allAddedIds.add(id);
    }

    const oemMatch =
      editOem && editEquipment ? `${editOem} - ${editEquipment}` : null;

    const base = allWorkers.filter((w) => {
      if (allAddedIds.has(w.id)) return false;
      if (!workerIsAvailable(w, slot.startDate, slot.endDate, project.id))
        return false;
      return true;
    });
    const total = base.length;

    const searchTerm = (editSlotSearch[slotKey] || "").toLowerCase();
    const fteOnly = editSlotFteOnly[slotKey] || false;
    const roleFilter = editSlotRoleFilter[slotKey] || [];
    const ccFilter = editSlotCostCentreFilter[slotKey] || [];
    const oemFilterArr = editSlotOemFilter[slotKey] || [];
    const certFilterArr = editSlotCertFilter[slotKey] || [];
    const todayStr = new Date().toISOString().split("T")[0];

    const filtered = base
      .filter((w) => {
        if (searchTerm && !w.name.toLowerCase().includes(searchTerm))
          return false;
        if (fteOnly && w.status !== "FTE") return false;
        if (roleFilter.length > 0 && !roleFilter.includes(w.role)) return false;
        if (ccFilter.length > 0) {
          const wcc = w.status === "FTE" ? (w.costCentre || "") : "Temp";
          if (!ccFilter.includes(wcc)) return false;
        }
        if (oemFilterArr.length > 0) {
          const workerOems = w.oemExperience.map((o: string) => o.split(" - ")[0]);
          if (!oemFilterArr.some(o => workerOems.includes(o))) return false;
        }
        if (certFilterArr.length > 0) {
          const docs = (w as any).documents as Array<{ type: string; expiryDate: string | null }> | undefined;
          if (!docs) return false;
          const hasAll = certFilterArr.every(certName => {
            const certType = "cert_" + certName.toLowerCase().replace(/[^a-z0-9]/g, "_");
            return docs.some((d: any) => d.type === certType && (!d.expiryDate || d.expiryDate >= todayStr));
          });
          if (!hasAll) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const statusOrder = (s: string) => (s === "FTE" ? 0 : 1);
        const sd = statusOrder(a.status) - statusOrder(b.status);
        if (sd !== 0) return sd;
        if (oemMatch) {
          const aMatch = a.oemExperience.includes(oemMatch) ? 0 : 1;
          const bMatch = b.oemExperience.includes(oemMatch) ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
        }
        return (
          calcUtilisation(a.assignments).pct -
          calcUtilisation(b.assignments).pct
        );
      });

    return { filtered, total };
  }

  function toggleEditExpandedWorker(wid: number) {
    setEditExpandedWorkers((prev) => {
      const next = new Set(prev);
      if (next.has(wid)) next.delete(wid);
      else next.add(wid);
      return next;
    });
  }

  async function assignWorkerToSlot(slotKey: number, workerId: number) {
    const slot = roleSlotEdits.find((s) => s.key === slotKey);
    if (!slot) return;
    const roleSlotId = slotKey < 0 ? Math.abs(slotKey) : null;
    const durationDays =
      slot.startDate && slot.endDate
        ? Math.max(
            1,
            Math.ceil(
              (new Date(slot.endDate).getTime() -
                new Date(slot.startDate).getTime()) /
                86400000
            )
          )
        : null;
    setSaving(true);
    try {
      await apiRequest("POST", "/api/assignments", {
        workerId,
        projectId: project.id,
        roleSlotId,
        role: slot.role,
        shift: slot.shift,
        startDate: slot.startDate,
        endDate: slot.endDate,
        duration: durationDays,
        status: "active",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Worker assigned" });
      onUpdate();
    } catch (e: any) {
      toast({
        title: "Error assigning worker",
        description: e.message || "Unknown error",
        variant: "destructive",
      });
    }
    setSaving(false);
  }

  const activeCount = members.length;
  const oemMatch =
    editOem && editEquipment ? `${editOem} - ${editEquipment}` : null;

  // Temp confirmation stats
  const tempMembers = members.filter(m => m.worker.status === "Temp");
  const tempsAwaitingConfirmation = tempMembers.filter(
    m => m.assignment.status === "active" || m.assignment.status === "pending_confirmation"
  );
  const showSendAllButton = tempsAwaitingConfirmation.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="text-base font-bold text-pfg-navy font-display flex items-center gap-3">
          Team Members
          <span
            className="text-sm font-semibold px-2.5 py-0.5 rounded-full"
            style={{
              background: "hsl(var(--accent))",
              color: "#8B6E00",
            }}
          >
            {activeCount}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {showSendAllButton && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium" style={{ color: "var(--amber, #D97706)" }}>
                {tempsAwaitingConfirmation.length} Temp{tempsAwaitingConfirmation.length !== 1 ? "s" : ""} awaiting confirmation
              </span>
              <button
                onClick={handleSendAllConfirmations}
                disabled={sendingAll}
                className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition"
                style={{ borderColor: "var(--pfg-yellow)", background: "hsl(var(--accent))", color: "var(--pfg-navy)" }}
              >
                {sendingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send to All Temps
              </button>
            </div>
          )}
        </div>
        {project.endDate &&
          members.some(
            (m) =>
              m.assignment.endDate &&
              m.assignment.endDate < project.endDate!
          ) && (
            <button
              onClick={async () => {
                if (!confirm(`Extend all assignments to ${project.endDate}?`))
                  return;
                for (const m of members) {
                  if (
                    m.assignment.endDate &&
                    m.assignment.endDate < project.endDate!
                  ) {
                    await apiRequest(
                      "PATCH",
                      `/api/assignments/${m.assignment.id}`,
                      { endDate: project.endDate }
                    );
                  }
                }
                await queryClient.invalidateQueries({
                  queryKey: ["/api/dashboard"],
                });
                onUpdate();
              }}
              className="text-[13px] font-semibold px-4 py-2 rounded-lg border"
              style={{
                borderColor: "var(--pfg-yellow)",
                color: "var(--pfg-navy)",
              }}
            >
              Extend All to {project.endDate}
            </button>
          )}
      </div>

      {roleSlotEdits.length === 0 ? (
        <div
          className="text-center py-12 rounded-xl border"
          style={{
            borderColor: "hsl(var(--border))",
            background: "hsl(var(--card))",
          }}
        >
          <div className="text-base font-medium text-pfg-navy mb-2">
            No role slots defined
          </div>
          <div className="text-[13px]" style={{ color: "var(--pfg-steel)" }}>
            Go to the Role Planning tab to define role slots first.
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {sortSlots(roleSlotEdits).map((slot) => {
            const slotMembers = getSlotMembers(slot.key);
            const filledCount = slotMembers.length;
            const { filtered: available, total: totalAvailable } =
              getEditAvailableWorkers(slot.key);
            const isFteOnly = editSlotFteOnly[slot.key] || false;
            const searchVal = editSlotSearch[slot.key] || "";

            return (
              <div
                key={slot.key}
                className="rounded-xl border"
                style={{
                  borderColor: "hsl(var(--border))",
                  background: "hsl(var(--card))",
                }}
              >
                {/* Slot header */}
                <div
                  className="px-5 py-3.5 text-[13px] font-semibold flex items-center justify-between"
                  style={{
                    background: "hsl(var(--muted))",
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  <div>
                    <span className="text-pfg-navy">{slot.role}</span>
                    <span
                      className="mx-2"
                      style={{ color: "var(--pfg-steel)" }}
                    >
                      &mdash;
                    </span>
                    <span style={{ color: "var(--pfg-steel)" }}>
                      {slot.shift} shift
                    </span>
                    <span
                      className="mx-2"
                      style={{ color: "var(--pfg-steel)" }}
                    >
                      &mdash;
                    </span>
                    <span style={{ color: "var(--pfg-steel)" }}>
                      {slot.startDate} to {slot.endDate}
                    </span>
                  </div>
                  <span
                    className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                    style={{
                      background:
                        filledCount >= slot.quantity
                          ? "var(--green-bg)"
                          : "hsl(var(--accent))",
                      color:
                        filledCount >= slot.quantity
                          ? "var(--green)"
                          : "#8B6E00",
                    }}
                  >
                    {filledCount}/{slot.quantity}
                  </span>
                </div>

                {/* Existing members for this slot */}
                {slotMembers.length > 0 && (
                  <div className="px-5 py-3 space-y-1.5">
                    {slotMembers.map((m) => (
                      <div
                        key={m.assignment.id}
                        className="flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors"
                        style={{ borderColor: "hsl(var(--border))" }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-pfg-navy">
                            {cleanName(m.worker.name)}
                            {m.worker.driversLicenseUploaded ? (
                              <span
                                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0"
                                style={{
                                  background: "#1A1D23",
                                  color: "#F5BD00",
                                }}
                                title="Has Driver's Licence"
                              >
                                D
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span
                              className="text-[11px]"
                              style={{ color: "var(--pfg-steel)" }}
                            >
                              {m.assignment.role || m.worker.role} ·{" "}
                              {m.assignment.startDate || "—"} →
                            </span>
                            <input
                              type="date"
                              value={m.assignment.endDate || ""}
                              onChange={async (e) => {
                                try {
                                  await apiRequest(
                                    "PATCH",
                                    `/api/assignments/${m.assignment.id}`,
                                    { endDate: e.target.value }
                                  );
                                  await queryClient.invalidateQueries({
                                    queryKey: ["/api/dashboard"],
                                  });
                                  onUpdate();
                                } catch {
                                  /* silent */
                                }
                              }}
                              className="text-[11px] px-1.5 py-0.5 border rounded"
                              style={{
                                borderColor: "hsl(var(--border))",
                                background: "hsl(var(--background))",
                                width: "120px",
                              }}
                            />
                            {m.assignment.endDate &&
                              project.endDate &&
                              m.assignment.endDate < project.endDate && (
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                  style={{
                                    background:
                                      "var(--amber-bg, hsl(var(--accent)))",
                                    color: "var(--amber, #D97706)",
                                  }}
                                >
                                  ends early
                                </span>
                              )}
                          </div>
                          <PeriodsManager assignmentId={m.assignment.id} onUpdate={onUpdate} />
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <ShiftBadge shift={m.assignment.shift} />
                          <StatusBadge status={m.worker.status} />
                          {m.worker.status === "Temp" && (
                            <>
                              <ConfirmationBadge assignment={m.assignment} />
                              {m.assignment.status !== "confirmed" && (
                                <div className="flex items-center gap-1">
                                  {/* Send / Resend email confirmation request */}
                                  <button
                                    onClick={() => handleSendConfirmation(m.assignment.id)}
                                    disabled={sendingConfirmation === m.assignment.id}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-lg border flex items-center gap-1 transition"
                                    style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-navy)" }}
                                    title={m.assignment.status === "pending_confirmation" ? "Resend confirmation request" : "Send confirmation request"}
                                  >
                                    {sendingConfirmation === m.assignment.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Mail className="w-3 h-3" />
                                    )}
                                    {m.assignment.status === "pending_confirmation" ? "Resend Request" : "Send Confirmation Request"}
                                  </button>
                                  {/* Manual / telephone confirm */}
                                  <button
                                    onClick={() => handleManualConfirm(m.assignment.id)}
                                    disabled={confirmingManually === m.assignment.id}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-lg border flex items-center gap-1 transition"
                                    style={{ borderColor: "var(--green)", color: "var(--green)" }}
                                    title="Mark as confirmed (e.g. confirmed by telephone)"
                                  >
                                    {confirmingManually === m.assignment.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <PhoneCall className="w-3 h-3" />
                                    )}
                                    Confirm Manually
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                          <button
                            onClick={() => handleRemove(m.assignment.id)}
                            className="ml-1 p-1 rounded hover:bg-[var(--red-bg)]"
                            title="Remove from project"
                          >
                            <X
                              className="w-3.5 h-3.5"
                              style={{ color: "var(--red)" }}
                            />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Available workers search/filter panel */}
                {filledCount < slot.quantity && (
                  <div className="px-5 py-3">
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="relative flex-1">
                        <Search
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                          style={{
                            color: "hsl(var(--muted-foreground))",
                          }}
                        />
                        <input
                          type="text"
                          placeholder="Search by name..."
                          value={searchVal}
                          onChange={(e) =>
                            setEditSlotSearch((prev) => ({
                              ...prev,
                              [slot.key]: e.target.value,
                            }))
                          }
                          className="w-full pl-8 pr-3 py-1.5 text-[12px] rounded-lg border"
                          style={inputStyle}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() =>
                            setEditSlotFteOnly((prev) => ({
                              ...prev,
                              [slot.key]: false,
                            }))
                          }
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border"
                          style={{
                            borderColor: !isFteOnly
                              ? "var(--pfg-yellow)"
                              : "hsl(var(--border))",
                            background: !isFteOnly
                              ? "hsl(var(--accent))"
                              : "transparent",
                            color: !isFteOnly
                              ? "var(--pfg-navy)"
                              : "hsl(var(--muted-foreground))",
                          }}
                        >
                          All
                        </button>
                        <button
                          onClick={() =>
                            setEditSlotFteOnly((prev) => ({
                              ...prev,
                              [slot.key]: true,
                            }))
                          }
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border"
                          style={{
                            borderColor: isFteOnly
                              ? "var(--pfg-yellow)"
                              : "hsl(var(--border))",
                            background: isFteOnly
                              ? "hsl(var(--accent))"
                              : "transparent",
                            color: isFteOnly
                              ? "var(--pfg-navy)"
                              : "hsl(var(--muted-foreground))",
                          }}
                        >
                          FTE only
                        </button>
                      </div>
                      <span
                        className="text-[11px] font-medium shrink-0"
                        style={{ color: "var(--pfg-steel)" }}
                      >
                        {available.length} of {totalAvailable} workers
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                      <TeamMultiSelect
                        label="Role"
                        options={PROJECT_ROLES}
                        selected={editSlotRoleFilter[slot.key] || []}
                        onChange={(v) => setEditSlotRoleFilter(prev => ({ ...prev, [slot.key]: v }))}
                      />
                      <TeamMultiSelect
                        label="Cost Centre"
                        options={[...COST_CENTRES, "Temp"]}
                        selected={editSlotCostCentreFilter[slot.key] || []}
                        onChange={(v) => setEditSlotCostCentreFilter(prev => ({ ...prev, [slot.key]: v }))}
                      />
                      <TeamMultiSelect
                        label="OEM"
                        options={OEM_OPTIONS}
                        selected={editSlotOemFilter[slot.key] || []}
                        onChange={(v) => setEditSlotOemFilter(prev => ({ ...prev, [slot.key]: v }))}
                      />
                      <TeamMultiSelect
                        label="Certificates"
                        options={CERT_DEFS.map(c => c.name)}
                        selected={editSlotCertFilter[slot.key] || []}
                        onChange={(v) => setEditSlotCertFilter(prev => ({ ...prev, [slot.key]: v }))}
                      />
                    </div>
                    <div className="max-h-[280px] overflow-y-auto space-y-0.5">
                      {available.length === 0 ? (
                        <div
                          className="text-center py-6 text-[13px]"
                          style={{
                            color: "hsl(var(--muted-foreground))",
                          }}
                        >
                          No available workers
                          {searchVal || isFteOnly
                            ? " matching filters"
                            : " without date conflicts"}
                        </div>
                      ) : (
                        available.map((w) => {
                          const util = calcUtilisation(w.assignments);
                          const hasOemMatch = oemMatch
                            ? w.oemExperience.includes(oemMatch)
                            : false;
                          const isExpanded = editExpandedWorkers.has(w.id);
                          const activeAssignment = w.assignments.find(
                            (a) => a.status === "active"
                          );
                          return (
                            <div key={w.id}>
                              <div
                                className="flex items-center gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors hover:border-[var(--pfg-yellow)] hover:bg-[hsl(var(--accent))]"
                                style={{
                                  borderColor: "hsl(var(--border))",
                                  background: "hsl(var(--card))",
                                }}
                              >
                                <div
                                  className="flex-1 min-w-0"
                                  onClick={() =>
                                    assignWorkerToSlot(slot.key, w.id)
                                  }
                                >
                                  <div className="text-[13px] font-semibold text-pfg-navy">
                                    {cleanName(w.name)}
                                    {w.driversLicenseUploaded ? (
                                      <span
                                        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0"
                                        style={{
                                          background: "#1A1D23",
                                          color: "#F5BD00",
                                        }}
                                        title="Has Driver's Licence"
                                      >
                                        D
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                    <span
                                      className="text-[11px]"
                                      style={{
                                        color: "var(--pfg-steel)",
                                      }}
                                    >
                                      {w.role}
                                    </span>
                                    {w.oemExperience
                                      .slice(0, 3)
                                      .map((exp) => (
                                        <span
                                          key={exp}
                                          className={`badge text-[10px] ${exp === oemMatch ? "badge-green" : "badge-grey"}`}
                                        >
                                          {exp}
                                        </span>
                                      ))}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span
                                    className="text-[11px] tabular-nums font-medium"
                                    style={{
                                      color:
                                        util.pct > 80
                                          ? "var(--red)"
                                          : "var(--pfg-steel)",
                                    }}
                                  >
                                    {util.pct}%
                                  </span>
                                  <StatusBadge status={w.status} />
                                  {hasOemMatch && (
                                    <span className="badge badge-green text-[10px]">
                                      OEM
                                    </span>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleEditExpandedWorker(w.id);
                                    }}
                                    className="p-0.5 rounded hover:bg-black/5"
                                    title="Preview worker details"
                                  >
                                    {isExpanded ? (
                                      <ChevronUp
                                        className="w-3.5 h-3.5"
                                        style={{
                                          color: "var(--pfg-steel)",
                                        }}
                                      />
                                    ) : (
                                      <Info
                                        className="w-3.5 h-3.5"
                                        style={{
                                          color: "var(--pfg-steel)",
                                        }}
                                      />
                                    )}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      assignWorkerToSlot(slot.key, w.id);
                                    }}
                                    className="p-0.5"
                                    disabled={saving}
                                  >
                                    {saving ? (
                                      <Loader2
                                        className="w-4 h-4 animate-spin"
                                        style={{
                                          color: "var(--pfg-steel)",
                                        }}
                                      />
                                    ) : (
                                      <Plus
                                        className="w-4 h-4"
                                        style={{
                                          color: "var(--pfg-yellow)",
                                        }}
                                      />
                                    )}
                                  </button>
                                </div>
                              </div>
                              {isExpanded && (
                                <div
                                  className="ml-3 mr-3 mb-1 px-4 py-2.5 rounded-b-lg border border-t-0 text-[12px]"
                                  style={{
                                    borderColor: "hsl(var(--border))",
                                    background: "hsl(var(--muted))",
                                  }}
                                >
                                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                    <div>
                                      <span
                                        style={{
                                          color: "var(--pfg-steel)",
                                        }}
                                      >
                                        Status:
                                      </span>{" "}
                                      <StatusBadge status={w.status} />
                                    </div>
                                    <div>
                                      <span
                                        style={{
                                          color: "var(--pfg-steel)",
                                        }}
                                      >
                                        English:
                                      </span>{" "}
                                      <span className="font-medium">
                                        {w.englishLevel || "\u2014"}
                                      </span>
                                    </div>
                                    <div>
                                      <span
                                        style={{
                                          color: "var(--pfg-steel)",
                                        }}
                                      >
                                        Utilisation:
                                      </span>{" "}
                                      <span
                                        className="font-medium tabular-nums"
                                        style={{
                                          color:
                                            util.pct > 80
                                              ? "var(--red)"
                                              : undefined,
                                        }}
                                      >
                                        {util.pct}%
                                      </span>
                                    </div>
                                    {activeAssignment && (
                                      <div>
                                        <span
                                          style={{
                                            color: "var(--pfg-steel)",
                                          }}
                                        >
                                          Current:
                                        </span>{" "}
                                        <span className="font-medium">
                                          {activeAssignment.projectCode}{" "}
                                          &mdash;{" "}
                                          {activeAssignment.projectName}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  {w.oemExperience.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                      {w.oemExperience.map((exp) => (
                                        <span
                                          key={exp}
                                          className={`badge text-[10px] ${exp === oemMatch ? "badge-green" : "badge-grey"}`}
                                        >
                                          {exp}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Unmatched members (no role slot) */}
          {unmatchedMembers.length > 0 && (
            <div
              className="rounded-xl border"
              style={{
                borderColor: "hsl(var(--border))",
                background: "hsl(var(--card))",
              }}
            >
              <div
                className="px-5 py-3.5 text-[13px] font-semibold"
                style={{
                  background: "hsl(var(--muted))",
                  borderBottom: "1px solid hsl(var(--border))",
                }}
              >
                <span className="text-pfg-navy">Unslotted Members</span>
                <span
                  className="ml-2 text-xs font-semibold px-2.5 py-0.5 rounded-full"
                  style={{
                    background: "var(--amber-bg, hsl(var(--accent)))",
                    color: "var(--amber, #D97706)",
                  }}
                >
                  {unmatchedMembers.length}
                </span>
              </div>
              <div className="px-5 py-3 space-y-1.5">
                {unmatchedMembers.map((m) => (
                  <div
                    key={m.assignment.id}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors"
                    style={{ borderColor: "hsl(var(--border))" }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-pfg-navy">
                        {cleanName(m.worker.name)}
                        {m.worker.driversLicenseUploaded ? (
                          <span
                            className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0"
                            style={{
                              background: "#1A1D23",
                              color: "#F5BD00",
                            }}
                            title="Has Driver's Licence"
                          >
                            D
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className="text-[11px]"
                          style={{ color: "var(--pfg-steel)" }}
                        >
                          {m.assignment.role || m.worker.role} ·{" "}
                          {m.assignment.startDate || "—"} →{" "}
                          {m.assignment.endDate || "—"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <ShiftBadge shift={m.assignment.shift} />
                      <StatusBadge status={m.worker.status} />
                      <button
                        onClick={() => handleRemove(m.assignment.id)}
                        className="ml-1 p-1 rounded hover:bg-[var(--red-bg)]"
                        title="Remove from project"
                      >
                        <X
                          className="w-3.5 h-3.5"
                          style={{ color: "var(--red)" }}
                        />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
