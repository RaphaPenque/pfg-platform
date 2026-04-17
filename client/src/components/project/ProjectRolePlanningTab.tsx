import React from "react";
import { useState, useMemo, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  useDashboardData,
  type DashboardProject,
  type DashboardWorker,
  type DashboardAssignment,
  type DashboardRoleSlot,
} from "@/hooks/use-dashboard-data";
import {
  OEM_OPTIONS,
  PROJECT_ROLES,
  PROJECT_CUSTOMER,
  sortSlots,
  cleanName,
  calcUtilisation,
} from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  Trash2,
  Save,
  Loader2,
  AlertTriangle,
  X,
  ChevronUp,
  ChevronDown,
  Info,
  CalendarDays,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────

interface RoleSlotDraft {
  key: number;
  role: string;
  startDate: string;
  endDate: string;
  quantity: number;
  shift: string;
}

interface ConflictItem {
  worker: DashboardWorker;
  thisAssignment: DashboardAssignment;
  otherAssignment: DashboardAssignment;
  resolution: "shorten" | "delay" | "flag" | null;
}

interface ConflictModalState {
  slotId: number;
  newStart: string;
  newEnd: string;
  projectCode: string;
  conflicts: ConflictItem[];
}

// ─── Shared helpers ─────────────────────────────────────────────

function datesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string | null,
  bEnd: string | null
): boolean {
  if (!bStart || !bEnd) return false;
  return aStart <= bEnd && aEnd >= bStart;
}

const inputCls =
  "px-3 py-2 text-[13px] rounded-lg border focus:outline-none focus:border-[var(--pfg-yellow)] focus:shadow-[0_0_0_3px_rgba(245,189,0,0.15)]";
const inputStyle = {
  borderColor: "hsl(var(--border))",
  background: "hsl(var(--card))",
};

// ─── Conflict Resolution Modal ──────────────────────────────────

function ConflictResolutionModal({
  data,
  onResolve,
  onClose,
}: {
  data: ConflictModalState;
  onResolve: (updated: ConflictItem[]) => void;
  onClose: () => void;
}) {
  const [conflicts, setConflicts] = useState<ConflictItem[]>(data.conflicts);
  const [saving, setSaving] = useState(false);

  const allResolved = conflicts.every((c) => c.resolution !== null);

  const setResolution = (
    idx: number,
    res: "shorten" | "delay" | "flag"
  ) => {
    setConflicts((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, resolution: res } : c))
    );
  };

  const handleApply = async () => {
    if (!allResolved) return;
    setSaving(true);
    try {
      for (const c of conflicts) {
        if (c.resolution === "shorten") {
          const dayBefore = new Date(c.otherAssignment.startDate!);
          dayBefore.setDate(dayBefore.getDate() - 1);
          const newEnd = dayBefore.toISOString().split("T")[0];
          await apiRequest("PATCH", `/api/assignments/${c.thisAssignment.id}`, {
            startDate: data.newStart,
            endDate: newEnd,
          });
        } else if (c.resolution === "delay") {
          const dayAfter = new Date(data.newEnd);
          dayAfter.setDate(dayAfter.getDate() + 1);
          const newStart = dayAfter.toISOString().split("T")[0];
          await apiRequest(
            "PATCH",
            `/api/assignments/${c.otherAssignment.id}`,
            { startDate: newStart }
          );
        } else if (c.resolution === "flag") {
          await apiRequest("PATCH", `/api/assignments/${c.thisAssignment.id}`, {
            status: "flagged",
          });
        }
      }
      onResolve(conflicts);
    } catch {
      /* silent */
    }
    setSaving(false);
  };

  const shortenDate = (c: ConflictItem) => {
    const d = new Date(c.otherAssignment.startDate!);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  };
  const delayDate = () => {
    const d = new Date(data.newEnd);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };

  const TimelineBar = ({ c }: { c: ConflictItem }) => {
    const allDates = [
      data.newStart,
      data.newEnd,
      c.otherAssignment.startDate!,
      c.otherAssignment.endDate!,
    ].map((d) => new Date(d).getTime());
    const min = Math.min(...allDates);
    const max = Math.max(...allDates);
    const range = max - min || 1;
    const pct = (d: string) =>
      ((new Date(d).getTime() - min) / range) * 100;

    const thisLeft = pct(data.newStart);
    const thisRight = 100 - pct(data.newEnd);
    const otherLeft = pct(c.otherAssignment.startDate!);
    const otherRight = 100 - pct(c.otherAssignment.endDate!);

    const overlapStart = Math.max(
      new Date(data.newStart).getTime(),
      new Date(c.otherAssignment.startDate!).getTime()
    );
    const overlapEnd = Math.min(
      new Date(data.newEnd).getTime(),
      new Date(c.otherAssignment.endDate!).getTime()
    );
    const overlapLeft = ((overlapStart - min) / range) * 100;
    const overlapRight = 100 - ((overlapEnd - min) / range) * 100;

    return (
      <div
        className="relative h-6 rounded"
        style={{ background: "hsl(var(--muted))" }}
      >
        <div
          className="absolute top-0.5 h-2 rounded-sm"
          style={{
            left: `${thisLeft}%`,
            right: `${thisRight}%`,
            background: "var(--pfg-navy, #1A1D23)",
          }}
        />
        <div
          className="absolute bottom-0.5 h-2 rounded-sm"
          style={{
            left: `${otherLeft}%`,
            right: `${otherRight}%`,
            background: "var(--pfg-steel, #64748B)",
          }}
        />
        <div
          className="absolute top-0 bottom-0 rounded-sm opacity-30"
          style={{
            left: `${overlapLeft}%`,
            right: `${overlapRight}%`,
            background: "var(--red, #dc2626)",
          }}
        />
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{
        background: "rgba(27,42,74,0.6)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        className="rounded-xl overflow-hidden w-[640px] max-w-[95vw] max-h-[85vh] flex flex-col"
        style={{
          background: "hsl(var(--card))",
          boxShadow: "0 20px 60px rgba(27,42,74,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-6 py-4 border-b flex items-center gap-3"
          style={{
            borderColor: "hsl(var(--border))",
            background: "var(--pfg-navy, #1A1D23)",
          }}
        >
          <AlertTriangle
            className="w-5 h-5"
            style={{ color: "var(--pfg-yellow, #F5BD00)" }}
          />
          <div>
            <h2 className="font-display font-bold text-white text-base">
              Scheduling Conflicts Detected
            </h2>
            <p className="text-[12px] text-white/60 mt-0.5">
              The following workers have overlapping assignments. Choose how to
              resolve each one.
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {conflicts.map((c, idx) => (
            <div
              key={c.thisAssignment.id}
              className="rounded-lg border overflow-hidden"
              style={{
                borderColor: c.resolution
                  ? "var(--green, #16a34a)"
                  : "var(--amber, #D97706)",
                borderLeftWidth: 3,
                background: "hsl(var(--card))",
              }}
            >
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-sm text-pfg-navy">
                    {cleanName(c.worker.name)}
                  </span>
                  <span
                    className={`badge text-[10px] ${c.worker.status === "FTE" ? "badge-navy" : "badge-grey"}`}
                  >
                    {c.worker.status}
                  </span>
                  {c.resolution && (
                    <span
                      className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                      style={{ background: "var(--green, #16a34a)" }}
                    >
                      {c.resolution === "shorten"
                        ? "Shortened"
                        : c.resolution === "delay"
                          ? "Delayed"
                          : "Flagged"}
                    </span>
                  )}
                </div>

                <div
                  className="flex items-center gap-2 text-[11px] mb-2"
                  style={{ color: "var(--pfg-steel)" }}
                >
                  <span
                    className="font-semibold"
                    style={{ color: "var(--pfg-navy)" }}
                  >
                    {data.projectCode}:
                  </span>
                  <span>
                    {data.newStart} → {data.newEnd}
                  </span>
                  <span style={{ color: "var(--red, #dc2626)" }}>↔</span>
                  <span
                    className="font-semibold"
                    style={{ color: "var(--pfg-navy)" }}
                  >
                    {c.otherAssignment.projectCode}:
                  </span>
                  <span>
                    {c.otherAssignment.startDate} →{" "}
                    {c.otherAssignment.endDate}
                  </span>
                </div>

                <TimelineBar c={c} />

                {!c.resolution && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => setResolution(idx, "shorten")}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg"
                      style={{
                        background: "var(--pfg-yellow, #F5BD00)",
                        color: "var(--pfg-navy, #1A1D23)",
                      }}
                    >
                      Shorten to {shortenDate(c)}
                    </button>
                    <button
                      onClick={() => setResolution(idx, "delay")}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border"
                      style={{
                        borderColor: "hsl(var(--border))",
                        color: "var(--pfg-navy)",
                      }}
                    >
                      Delay {c.otherAssignment.projectCode} to {delayDate()}
                    </button>
                    <button
                      onClick={() => setResolution(idx, "flag")}
                      className="text-[11px] font-medium px-3 py-1.5 rounded-lg"
                      style={{
                        background: "hsl(var(--muted))",
                        color: "var(--pfg-steel)",
                      }}
                    >
                      Flag for Review
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          className="px-6 py-4 border-t flex items-center justify-between"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <span className="text-[12px]" style={{ color: "var(--pfg-steel)" }}>
            {conflicts.filter((c) => c.resolution).length} of{" "}
            {conflicts.length} resolved
          </span>
          <button
            onClick={handleApply}
            disabled={!allResolved || saving}
            className="text-[13px] font-bold px-5 py-2 rounded-lg disabled:opacity-40"
            style={{
              background: "var(--pfg-yellow, #F5BD00)",
              color: "var(--pfg-navy, #1A1D23)",
            }}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Apply Resolutions"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

// ── Slot Periods Manager ────────────────────────────────────────────────────
function SlotPeriodsManager({ slotId, onUpdate }: { slotId: number; onUpdate: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [addingPeriod, setAddingPeriod] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ startDate: "", endDate: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const { data: periods = [], refetch } = useQuery<any[]>({
    queryKey: [`/api/role-slots/${slotId}/periods`],
    enabled: open,
  });

  const handleAdd = useCallback(async () => {
    if (!newPeriod.startDate || !newPeriod.endDate) return;
    setSaving(true);
    try {
      await apiRequest("POST", `/api/role-slots/${slotId}/periods`, {
        ...newPeriod,
        periodType: "remob",
      });
      setNewPeriod({ startDate: "", endDate: "", notes: "" });
      setAddingPeriod(false);
      refetch();
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onUpdate();
      toast({ title: "Remob period added" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }, [slotId, newPeriod, refetch, onUpdate, toast]);

  const handleDelete = useCallback(async (periodId: number) => {
    if (!confirm("Remove this remob period?")) return;
    try {
      await apiRequest("DELETE", `/api/role-slot-periods/${periodId}`);
      refetch();
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onUpdate();
      toast({ title: "Period removed" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  }, [refetch, onUpdate, toast]);

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[11px] font-semibold mt-1"
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
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                style={{ background: p.periodType === "initial" ? "hsl(var(--muted))" : "#fef3c7", color: p.periodType === "initial" ? "var(--pfg-steel)" : "#92400e" }}>
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
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <input type="date" value={newPeriod.startDate}
                onChange={e => setNewPeriod(p => ({ ...p, startDate: e.target.value }))}
                className="text-[11px] px-1.5 py-0.5 border rounded" style={{ borderColor: "hsl(var(--border))" }} />
              <span style={{ color: "var(--pfg-steel)" }}>to</span>
              <input type="date" value={newPeriod.endDate}
                onChange={e => setNewPeriod(p => ({ ...p, endDate: e.target.value }))}
                className="text-[11px] px-1.5 py-0.5 border rounded" style={{ borderColor: "hsl(var(--border))" }} />
              <input type="text" value={newPeriod.notes}
                onChange={e => setNewPeriod(p => ({ ...p, notes: e.target.value }))}
                placeholder="Notes (optional)"
                className="text-[11px] px-1.5 py-0.5 border rounded flex-1" style={{ borderColor: "hsl(var(--border))" }} />
              <button onClick={handleAdd} disabled={saving || !newPeriod.startDate || !newPeriod.endDate}
                className="text-[11px] font-semibold px-2 py-0.5 rounded disabled:opacity-50"
                style={{ background: "var(--pfg-navy)", color: "#fff" }}>
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
              </button>
              <button onClick={() => setAddingPeriod(false)} className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setAddingPeriod(true)}
              className="flex items-center gap-1 text-[11px] font-semibold mt-1"
              style={{ color: "#005E60" }}>
              <Plus className="w-3 h-3" /> Add Remob Period
            </button>
          )}
        </div>
      )}
    </>
  );
}

export default function ProjectRolePlanningTab({
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

  const customer = project.customer || PROJECT_CUSTOMER[project.code] || "";
  const editOem =
    OEM_OPTIONS.find((o) => customer.includes(o)) || "";

  // Build card-like members array for conflict checking
  const members = useMemo(() => {
    return allAssignments
      .filter(
        (a: DashboardAssignment) =>
          a.projectId === project.id &&
          (a.status === "active" || a.status === "flagged")
      )
      .map((a: DashboardAssignment) => {
        const worker = allWorkers.find((w) => w.id === a.workerId);
        return worker ? { worker, assignment: a } : null;
      })
      .filter(Boolean) as { worker: DashboardWorker; assignment: DashboardAssignment }[];
  }, [allAssignments, allWorkers, project.id]);

  // ── Role Planning state ──
  const existingSlots = allRoleSlots.filter((s) => s.projectId === project.id);
  const [roleSlotEdits, setRoleSlotEdits] = useState<RoleSlotDraft[]>(
    existingSlots.map((s) => ({
      key: -(s.id),
      role: s.role,
      startDate: s.startDate,
      endDate: s.endDate,
      quantity: s.quantity,
      shift: s.shift || "Day",
    }))
  );
  const [nextRoleKey, setNextRoleKey] = useState(1);
  const [deletedSlotIds, setDeletedSlotIds] = useState<number[]>([]);
  const computedHeadcount =
    roleSlotEdits.reduce((sum, s) => sum + (s.quantity || 0), 0) ||
    (project.headcount || 0);
  const [slotSaving, setSlotSaving] = useState<number | null>(null);
  const [slotConflicts, setSlotConflicts] = useState<
    Record<number, string[]>
  >({});
  const [conflictModalData, setConflictModalData] =
    useState<ConflictModalState | null>(null);
  const [saving, setSaving] = useState(false);

  const addEditRoleSlot = () => {
    setRoleSlotEdits((prev) => [
      ...prev,
      {
        key: nextRoleKey,
        role: "Technician 2",
        startDate: project.startDate || "",
        endDate: project.endDate || "",
        quantity: 1,
        shift: "Day",
      },
    ]);
    setNextRoleKey((k) => k + 1);
  };

  const updateEditSlot = (
    key: number,
    field: keyof RoleSlotDraft,
    value: string | number
  ) => {
    setRoleSlotEdits((prev) =>
      prev.map((s) => (s.key === key ? { ...s, [field]: value } : s))
    );
  };

  const removeEditSlot = async (key: number) => {
    if (key < 0) {
      const slotId = Math.abs(key);
      try {
        await apiRequest("DELETE", `/api/role-slots/${slotId}`);
        await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
        toast({ title: "Role slot deleted" });
      } catch (e: any) {
        toast({
          title: "Error deleting slot",
          description: e.message || "Unknown error",
          variant: "destructive",
        });
        return;
      }
    }
    setRoleSlotEdits((prev) => prev.filter((s) => s.key !== key));
    onUpdate();
  };

  // Save existing role slot changes via PATCH
  const saveEditSlot = async (key: number) => {
    if (key >= 0) return; // new slots saved via "Add New Slot" flow
    const slotId = Math.abs(key);
    const slot = roleSlotEdits.find((s) => s.key === key);
    if (!slot) return;
    setSlotSaving(key);
    try {
      await apiRequest("PATCH", `/api/role-slots/${slotId}`, {
        role: slot.role,
        startDate: slot.startDate,
        endDate: slot.endDate,
        quantity: slot.quantity,
        shift: slot.shift,
      });

      // Find all workers assigned to this slot
      const slotAssignments = members.filter(
        (m) =>
          m.assignment.roleSlotId === slotId ||
          (!m.assignment.roleSlotId && m.assignment.role === slot.role)
      );

      const cleanWorkers: {
        member: (typeof slotAssignments)[0];
      }[] = [];
      const conflictItems: ConflictItem[] = [];

      for (const m of slotAssignments) {
        const fullWorker = allWorkers.find((w) => w.id === m.worker.id);
        if (!fullWorker) continue;

        const otherConflict = fullWorker.assignments.find(
          (a) =>
            a.projectId !== project.id &&
            (a.status === "active" || a.status === "flagged") &&
            a.startDate &&
            a.endDate &&
            datesOverlap(slot.startDate, slot.endDate, a.startDate, a.endDate)
        );

        if (otherConflict) {
          conflictItems.push({
            worker: fullWorker,
            thisAssignment: m.assignment,
            otherAssignment: otherConflict,
            resolution: null,
          });
        } else {
          cleanWorkers.push({ member: m });
        }
      }

      let autoUpdated = 0;
      for (const { member } of cleanWorkers) {
        try {
          await apiRequest(
            "PATCH",
            `/api/assignments/${member.assignment.id}`,
            {
              startDate: slot.startDate,
              endDate: slot.endDate,
            }
          );
          autoUpdated++;
        } catch {
          /* silent */
        }
      }

      setSlotConflicts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      if (conflictItems.length > 0) {
        setConflictModalData({
          slotId,
          newStart: slot.startDate,
          newEnd: slot.endDate,
          projectCode: project.code,
          conflicts: conflictItems,
        });
      } else {
        if (autoUpdated > 0) {
          toast({
            title: "Role slot updated",
            description: `${autoUpdated} worker${autoUpdated === 1 ? "" : "s"} updated automatically.`,
          });
        }
        await queryClient.invalidateQueries({
          queryKey: ["/api/dashboard"],
        });
        onUpdate();
      }
    } catch (e: any) {
      toast({
        title: "Error saving slot",
        description: e.message || "Unknown error",
        variant: "destructive",
      });
    }
    setSlotSaving(null);
  };

  const handleConflictResolved = async (_resolved: ConflictItem[]) => {
    setConflictModalData(null);
    await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    toast({ title: "Conflicts resolved" });
    onUpdate();
  };

  // Save new slots (key > 0)
  const saveNewSlot = async (key: number) => {
    if (key <= 0) return;
    const slot = roleSlotEdits.find((s) => s.key === key);
    if (!slot) return;
    setSaving(true);
    try {
      await apiRequest("POST", "/api/role-slots", {
        projectId: project.id,
        role: slot.role,
        startDate: slot.startDate,
        endDate: slot.endDate,
        quantity: slot.quantity,
        shift: slot.shift,
      });
      // Remove from local drafts (it will re-appear from server data on refetch)
      setRoleSlotEdits((prev) => prev.filter((s) => s.key !== key));
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Role slot created" });
      onUpdate();
    } catch (e: any) {
      toast({
        title: "Error creating slot",
        description: e.message || "Unknown error",
        variant: "destructive",
      });
    }
    setSaving(false);
  };

  return (
    <div>
      {conflictModalData && (
        <ConflictResolutionModal
          data={conflictModalData}
          onResolve={handleConflictResolved}
          onClose={() => setConflictModalData(null)}
        />
      )}

      <div className="flex items-center justify-between mb-5">
        <div className="text-base font-bold text-pfg-navy font-display flex items-center gap-3">
          Role Slots
          <span
            className="text-sm font-semibold px-2.5 py-0.5 rounded-full"
            style={{
              background: "hsl(var(--accent))",
              color: "#8B6E00",
            }}
          >
            {roleSlotEdits.reduce((s, r) => s + r.quantity, 0)} positions
          </span>
        </div>
        <button
          onClick={addEditRoleSlot}
          className="flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-lg border"
          style={{
            borderColor: "var(--pfg-yellow)",
            color: "var(--pfg-navy)",
            background: "hsl(var(--accent))",
          }}
        >
          <Plus className="w-4 h-4" />
          Add Role
        </button>
      </div>

      {roleSlotEdits.length === 0 ? (
        <div
          className="text-center py-16 rounded-xl border"
          style={{
            color: "hsl(var(--muted-foreground))",
            borderColor: "hsl(var(--border))",
            background: "hsl(var(--card))",
          }}
        >
          <div className="text-base font-medium text-pfg-navy mb-2">
            No role slots defined
          </div>
          <div className="text-[13px]" style={{ color: "var(--pfg-steel)" }}>
            Click "Add Role" to start planning your workforce requirements.
          </div>
        </div>
      ) : (
        <div
          className="rounded-xl border overflow-hidden"
          style={{
            borderColor: "hsl(var(--border))",
            background: "hsl(var(--card))",
          }}
        >
          <table
            className="w-full text-[13px]"
            style={{ borderCollapse: "collapse" }}
          >
            <thead>
              <tr>
                {["Role", "Shift", "Start Date", "End Date", "Qty", ""].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        background: "hsl(var(--muted))",
                        color: "hsl(var(--muted-foreground))",
                        borderBottom: "1px solid hsl(var(--border))",
                      }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {sortSlots(roleSlotEdits).map((slot) => (
                <React.Fragment key={slot.key}>
                <tr>
                  <td
                    className="px-4 py-2.5"
                    style={{
                      borderBottom: "1px solid hsl(var(--border))",
                    }}
                  >
                    <select
                      className="text-[13px] px-2 py-1.5 rounded border w-full"
                      style={inputStyle}
                      value={slot.role}
                      onChange={(e) =>
                        updateEditSlot(slot.key, "role", e.target.value)
                      }
                    >
                      {PROJECT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td
                    className="px-4 py-2.5"
                    style={{
                      borderBottom: "1px solid hsl(var(--border))",
                    }}
                  >
                    <select
                      className="text-[13px] px-2 py-1.5 rounded border"
                      style={inputStyle}
                      value={slot.shift}
                      onChange={(e) =>
                        updateEditSlot(slot.key, "shift", e.target.value)
                      }
                    >
                      <option value="Day">Day</option>
                      <option value="Night">Night</option>
                    </select>
                  </td>
                  <td
                    className="px-4 py-2.5"
                    style={{
                      borderBottom: "1px solid hsl(var(--border))",
                    }}
                  >
                    <input
                      type="date"
                      className="text-[13px] px-2 py-1.5 rounded border"
                      style={inputStyle}
                      value={slot.startDate}
                      onChange={(e) =>
                        updateEditSlot(slot.key, "startDate", e.target.value)
                      }
                    />
                  </td>
                  <td
                    className="px-4 py-2.5"
                    style={{
                      borderBottom: "1px solid hsl(var(--border))",
                    }}
                  >
                    <input
                      type="date"
                      className="text-[13px] px-2 py-1.5 rounded border"
                      style={inputStyle}
                      value={slot.endDate}
                      onChange={(e) =>
                        updateEditSlot(slot.key, "endDate", e.target.value)
                      }
                    />
                  </td>
                  <td
                    className="px-4 py-2.5"
                    style={{
                      borderBottom: "1px solid hsl(var(--border))",
                    }}
                  >
                    <input
                      type="number"
                      min={1}
                      max={50}
                      className="text-[13px] px-2 py-1.5 rounded border w-20 tabular-nums"
                      style={inputStyle}
                      value={slot.quantity}
                      onChange={(e) =>
                        updateEditSlot(
                          slot.key,
                          "quantity",
                          parseInt(e.target.value) || 1
                        )
                      }
                    />
                  </td>
                  <td
                    className="px-4 py-2.5 text-center"
                    style={{
                      borderBottom: "1px solid hsl(var(--border))",
                    }}
                  >
                    <div className="flex items-center gap-1.5 justify-center">
                      {slot.key < 0 && (
                        <button
                          onClick={() => saveEditSlot(slot.key)}
                          disabled={slotSaving === slot.key}
                          className="p-1.5 rounded hover:bg-[var(--green-bg)]"
                          title="Save changes to this role slot"
                        >
                          {slotSaving === slot.key ? (
                            <Loader2
                              className="w-4 h-4 animate-spin"
                              style={{ color: "var(--pfg-steel)" }}
                            />
                          ) : (
                            <Save
                              className="w-4 h-4"
                              style={{ color: "var(--green)" }}
                            />
                          )}
                        </button>
                      )}
                      {slot.key > 0 && (
                        <button
                          onClick={() => saveNewSlot(slot.key)}
                          disabled={saving}
                          className="p-1.5 rounded hover:bg-[var(--green-bg)]"
                          title="Save new role slot"
                        >
                          {saving ? (
                            <Loader2
                              className="w-4 h-4 animate-spin"
                              style={{ color: "var(--pfg-steel)" }}
                            />
                          ) : (
                            <Save
                              className="w-4 h-4"
                              style={{ color: "var(--green)" }}
                            />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => removeEditSlot(slot.key)}
                        className="p-1.5 rounded hover:bg-[var(--red-bg)]"
                      >
                        <Trash2
                          className="w-4 h-4"
                          style={{ color: "var(--red)" }}
                        />
                      </button>
                    </div>
                  </td>
                </tr>
                {/* Deployment Periods — only for saved slots (key < 0 means existing DB slot with id = abs(key)) */}
                {slot.key < 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 pb-2.5 pt-1" style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted)/0.3)" }}>
                      <SlotPeriodsManager slotId={Math.abs(slot.key)} onUpdate={onUpdate} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Conflict warnings */}
      {Object.keys(slotConflicts).length > 0 && (
        <div className="mt-4 space-y-1.5">
          {Object.entries(slotConflicts).map(([key, names]) => (
            <div
              key={key}
              className="flex items-start gap-2 text-[12px] font-medium px-4 py-2.5 rounded-lg"
              style={{
                background: "var(--amber-bg, hsl(var(--accent)))",
                color: "var(--amber, #D97706)",
              }}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Warning: {names.join(", ")}{" "}
                {names.length === 1 ? "is" : "are"} assigned outside these new
                dates. Update their assignment dates in the Team tab.
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
