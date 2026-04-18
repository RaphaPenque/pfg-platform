import React, { useState, useMemo, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  useDashboardData,
  type DashboardProject,
  type DashboardAssignment,
} from "@/hooks/use-dashboard-data";
import { PROJECT_ROLES, sortSlots, cleanName, slotLabel } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Trash2, Loader2, X, CalendarDays } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────
interface NewSlotDraft {
  role: string;
  startDate: string;
  endDate: string;
  quantity: number;
  shift: string;
}

interface PeriodEditModalState {
  periodId: number | null;
  slotId: number;
  startDate: string;
  endDate: string;
  periodType: "initial" | "remob";
  notes: string;
}

// ─── Helpers ────────────────────────────────────────────────────

function toUTCDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function mondayOf(d: Date): Date {
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7;
  const m = new Date(d);
  m.setUTCDate(m.getUTCDate() - diff);
  return m;
}

function buildWeekColumns(start: string, end: string): { start: Date; label: string }[] {
  if (!start || !end) return [];
  const s = mondayOf(toUTCDate(start));
  const e = toUTCDate(end);
  const weeks: { start: Date; label: string }[] = [];
  const cursor = new Date(s);
  while (cursor.getTime() <= e.getTime()) {
    const monthShort = cursor.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    const dayNum = cursor.getUTCDate();
    weeks.push({ start: new Date(cursor), label: `${dayNum} ${monthShort}` });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

function dateToColumnFraction(dateStr: string, weekColumns: { start: Date }[]): number {
  if (!dateStr || weekColumns.length === 0) return 0;
  const d = toUTCDate(dateStr).getTime();
  const first = weekColumns[0].start.getTime();
  const weekMs = 7 * 86400000;
  const fractionalWeek = (d - first) / weekMs;
  return Math.max(0, Math.min(weekColumns.length, fractionalWeek));
}

// ─── Period Edit Modal ──────────────────────────────────────────

function PeriodEditModal({
  data,
  onClose,
  onSaved,
}: {
  data: PeriodEditModalState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(data);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.startDate || !form.endDate) return;
    setSaving(true);
    try {
      if (form.periodId) {
        await apiRequest("PATCH", `/api/role-slot-periods/${form.periodId}`, {
          startDate: form.startDate,
          endDate: form.endDate,
          periodType: form.periodType,
          notes: form.notes || null,
        });
      } else {
        await apiRequest("POST", `/api/role-slots/${form.slotId}/periods`, {
          startDate: form.startDate,
          endDate: form.endDate,
          periodType: form.periodType,
          notes: form.notes || null,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      await queryClient.invalidateQueries({ queryKey: [`/api/role-slots/${form.slotId}/periods`] });
      toast({ title: form.periodId ? "Period updated" : "Period added" });
      onSaved();
      onClose();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message || "Unknown error", variant: "destructive" });
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!form.periodId) return;
    if (!confirm("Delete this period?")) return;
    setSaving(true);
    try {
      await apiRequest("DELETE", `/api/role-slot-periods/${form.periodId}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      await queryClient.invalidateQueries({ queryKey: [`/api/role-slots/${form.slotId}/periods`] });
      toast({ title: "Period deleted" });
      onSaved();
      onClose();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message || "Unknown error", variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center" style={{ background: "rgba(27,42,74,0.6)", backdropFilter: "blur(2px)" }}>
      <div className="rounded-xl overflow-hidden w-[520px] max-w-[95vw]" style={{ background: "hsl(var(--card))", boxShadow: "0 20px 60px rgba(27,42,74,0.3)" }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(var(--border))", background: "var(--pfg-navy, #1A1D23)" }}>
          <h2 className="font-display font-bold text-white text-base">
            {form.periodId ? "Edit Period" : "Add Period"}
          </h2>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Type</label>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setForm(f => ({ ...f, periodType: "initial" }))}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border"
                style={{
                  borderColor: form.periodType === "initial" ? "var(--pfg-yellow)" : "hsl(var(--border))",
                  background: form.periodType === "initial" ? "hsl(var(--accent))" : "transparent",
                  color: form.periodType === "initial" ? "var(--pfg-navy)" : "var(--pfg-steel)",
                }}
              >
                Initial MOB
              </button>
              <button
                onClick={() => setForm(f => ({ ...f, periodType: "remob" }))}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border"
                style={{
                  borderColor: form.periodType === "remob" ? "var(--pfg-yellow)" : "hsl(var(--border))",
                  background: form.periodType === "remob" ? "hsl(var(--accent))" : "transparent",
                  color: form.periodType === "remob" ? "var(--pfg-navy)" : "var(--pfg-steel)",
                }}
              >
                REMOB
              </button>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Start Date</label>
              <input
                type="date"
                value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="text-[13px] px-2 py-1.5 rounded border w-full mt-1"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
              />
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>End Date</label>
              <input
                type="date"
                value={form.endDate}
                onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                className="text-[13px] px-2 py-1.5 rounded border w-full mt-1"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Notes</label>
            <input
              type="text"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. Disassembly, Reassembly"
              className="text-[13px] px-2 py-1.5 rounded border w-full mt-1"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
            />
          </div>
        </div>
        <div className="px-6 py-3 border-t flex items-center justify-between" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }}>
          {form.periodId ? (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg"
              style={{ color: "var(--red)" }}
            >
              <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg" style={{ color: "var(--pfg-steel)" }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.startDate || !form.endDate}
              className="text-[12px] font-bold px-4 py-1.5 rounded-lg disabled:opacity-40"
              style={{ background: "var(--pfg-yellow, #F5BD00)", color: "var(--pfg-navy)" }}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export default function ProjectRolePlanningTab({
  project,
  onUpdate,
}: {
  project: DashboardProject;
  onUpdate: () => void;
}) {
  const { data } = useDashboardData();
  const allRoleSlots = data?.roleSlots ?? [];
  const allAssignments = data?.assignments ?? [];
  const allWorkers = data?.workers ?? [];
  const { toast } = useToast();

  const projectSlots = useMemo(
    () => sortSlots(allRoleSlots.filter(s => s.projectId === project.id)),
    [allRoleSlots, project.id]
  );

  const weekColumns = useMemo(
    () => buildWeekColumns(project.startDate || "", project.endDate || ""),
    [project.startDate, project.endDate]
  );

  const [newSlot, setNewSlot] = useState<NewSlotDraft | null>(null);
  const [savingNewSlot, setSavingNewSlot] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<PeriodEditModalState | null>(null);
  const [deletingSlotId, setDeletingSlotId] = useState<number | null>(null);

  const handleAddSlot = async () => {
    if (!newSlot) return;
    setSavingNewSlot(true);
    try {
      await apiRequest("POST", "/api/role-slots", {
        projectId: project.id,
        role: newSlot.role,
        startDate: newSlot.startDate,
        endDate: newSlot.endDate,
        quantity: newSlot.quantity,
        shift: newSlot.shift,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Role slot created" });
      setNewSlot(null);
      onUpdate();
    } catch (e: any) {
      toast({ title: "Error creating slot", description: e.message || "Unknown error", variant: "destructive" });
    }
    setSavingNewSlot(false);
  };

  const handleDeleteSlot = async (slotId: number) => {
    const slotAssignments = allAssignments.filter(
      (a: DashboardAssignment) =>
        a.roleSlotId === slotId && (a.status === "active" || a.status === "confirmed")
    );
    if (slotAssignments.length > 0) {
      toast({
        title: "Cannot delete slot",
        description: `${slotAssignments.length} active assignment(s) exist. Remove them in the Team tab first.`,
        variant: "destructive",
      });
      return;
    }
    if (!confirm("Delete this role slot? This will also delete all its periods.")) return;
    setDeletingSlotId(slotId);
    try {
      await apiRequest("DELETE", `/api/role-slots/${slotId}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Role slot deleted" });
      onUpdate();
    } catch (e: any) {
      toast({ title: "Error deleting slot", description: e.message || "Unknown error", variant: "destructive" });
    }
    setDeletingSlotId(null);
  };

  const totalSlots = projectSlots.reduce((sum, s) => sum + (s.quantity || 0), 0);

  return (
    <div>
      {editingPeriod && (
        <PeriodEditModal
          data={editingPeriod}
          onClose={() => setEditingPeriod(null)}
          onSaved={() => onUpdate()}
        />
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-base font-bold text-pfg-navy font-display flex items-center gap-3">
            Role Planning
            <span className="text-sm font-semibold px-2.5 py-0.5 rounded-full" style={{ background: "hsl(var(--accent))", color: "#8B6E00" }}>
              {totalSlots} positions · {projectSlots.length} slots
            </span>
          </div>
          <div className="text-[12px] mt-1" style={{ color: "var(--pfg-steel)" }}>
            Define role slots and deployment periods. Worker assignments are managed in the Team tab.
          </div>
        </div>
        <button
          onClick={() => setNewSlot({
            role: "Technician 2",
            startDate: project.startDate || "",
            endDate: project.endDate || "",
            quantity: 1,
            shift: "Day",
          })}
          className="flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-lg border"
          style={{ borderColor: "var(--pfg-yellow)", color: "var(--pfg-navy)", background: "hsl(var(--accent))" }}
        >
          <Plus className="w-4 h-4" /> Add Role Slot
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[11px]" style={{ color: "var(--pfg-steel)" }}>
        <div className="flex items-center gap-1.5">
          <span style={{ display: "inline-block", width: 16, height: 10, background: "var(--teal, #005E60)", borderRadius: 2 }} />
          Filled
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ display: "inline-block", width: 16, height: 10, border: "1.5px dashed #D97706", background: "#FEF3C7", borderRadius: 2 }} />
          Unassigned
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ display: "inline-block", width: 16, height: 10, background: "#DBEAFE", borderRadius: 2 }} />
          Initial
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ display: "inline-block", width: 16, height: 10, background: "#DCFCE7", borderRadius: 2 }} />
          Remob
        </div>
      </div>

      {newSlot && (
        <div className="rounded-xl border mb-4 p-4" style={{ borderColor: "var(--pfg-yellow)", background: "hsl(var(--accent))" }}>
          <div className="text-[13px] font-bold text-pfg-navy mb-2.5">New Role Slot</div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide block" style={{ color: "var(--pfg-steel)" }}>Role</label>
              <select
                value={newSlot.role}
                onChange={e => setNewSlot(s => s ? { ...s, role: e.target.value } : null)}
                className="text-[13px] px-2 py-1.5 rounded border mt-0.5"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
              >
                {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide block" style={{ color: "var(--pfg-steel)" }}>Shift</label>
              <select
                value={newSlot.shift}
                onChange={e => setNewSlot(s => s ? { ...s, shift: e.target.value } : null)}
                className="text-[13px] px-2 py-1.5 rounded border mt-0.5"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
              >
                <option value="Day">Day</option>
                <option value="Night">Night</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide block" style={{ color: "var(--pfg-steel)" }}>Start</label>
              <input
                type="date"
                value={newSlot.startDate}
                onChange={e => setNewSlot(s => s ? { ...s, startDate: e.target.value } : null)}
                className="text-[13px] px-2 py-1.5 rounded border mt-0.5"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide block" style={{ color: "var(--pfg-steel)" }}>End</label>
              <input
                type="date"
                value={newSlot.endDate}
                onChange={e => setNewSlot(s => s ? { ...s, endDate: e.target.value } : null)}
                className="text-[13px] px-2 py-1.5 rounded border mt-0.5"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide block" style={{ color: "var(--pfg-steel)" }}>Qty</label>
              <input
                type="number"
                min={1}
                max={50}
                value={newSlot.quantity}
                onChange={e => setNewSlot(s => s ? { ...s, quantity: parseInt(e.target.value) || 1 } : null)}
                className="text-[13px] px-2 py-1.5 rounded border w-16 mt-0.5 tabular-nums"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
              />
            </div>
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => setNewSlot(null)}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-lg"
                style={{ color: "var(--pfg-steel)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddSlot}
                disabled={savingNewSlot}
                className="text-[12px] font-bold px-4 py-1.5 rounded-lg"
                style={{ background: "var(--pfg-navy)", color: "#fff" }}
              >
                {savingNewSlot ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {projectSlots.length === 0 ? (
        <div className="text-center py-16 rounded-xl border" style={{ color: "hsl(var(--muted-foreground))", borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <div className="text-base font-medium text-pfg-navy mb-2">No role slots defined</div>
          <div className="text-[13px]" style={{ color: "var(--pfg-steel)" }}>
            Click "Add Role Slot" to start planning your workforce requirements.
          </div>
        </div>
      ) : weekColumns.length === 0 ? (
        <div className="text-center py-12 rounded-xl border" style={{ color: "hsl(var(--muted-foreground))", borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          Set project start and end dates to view the Gantt.
        </div>
      ) : (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
        >
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: Math.max(800, 260 + weekColumns.length * 48 + 60) }}>
              {/* Header */}
              <div
                className="flex items-center"
                style={{
                  background: "hsl(var(--muted))",
                  borderBottom: "1px solid hsl(var(--border))",
                  height: 38,
                }}
              >
                <div
                  className="flex-shrink-0 px-4 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ width: 260, color: "hsl(var(--muted-foreground))", borderRight: "1px solid hsl(var(--border))" }}
                >
                  Role Slot
                </div>
                <div className="flex-1 flex" style={{ position: "relative" }}>
                  {weekColumns.map((w, i) => (
                    <div
                      key={i}
                      className="text-[9px] text-center"
                      style={{
                        flex: 1,
                        minWidth: 48,
                        color: "hsl(var(--muted-foreground))",
                        borderLeft: i === 0 ? "none" : "1px dashed hsl(var(--border))",
                        padding: "12px 0",
                      }}
                    >
                      {w.label}
                    </div>
                  ))}
                </div>
                <div style={{ width: 60, borderLeft: "1px solid hsl(var(--border))" }} />
              </div>

              {/* Rows */}
              {projectSlots.map(slot => (
                <SlotGanttRow
                  key={slot.id}
                  slot={slot}
                  allSlots={projectSlots}
                  weekColumns={weekColumns}
                  assignments={allAssignments.filter((a: DashboardAssignment) => a.roleSlotId === slot.id)}
                  workers={allWorkers}
                  onEditPeriod={setEditingPeriod}
                  onDeleteSlot={handleDeleteSlot}
                  deletingSlotId={deletingSlotId}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Slot Gantt Row ─────────────────────────────────────────────

function SlotGanttRow({
  slot,
  allSlots,
  weekColumns,
  assignments,
  workers,
  onEditPeriod,
  onDeleteSlot,
  deletingSlotId,
}: {
  slot: any;
  allSlots: any[];
  weekColumns: { start: Date; label: string }[];
  assignments: DashboardAssignment[];
  workers: any[];
  onEditPeriod: (p: PeriodEditModalState) => void;
  onDeleteSlot: (slotId: number) => void;
  deletingSlotId: number | null;
}) {
  const { data: periods = [] } = useQuery<any[]>({
    queryKey: [`/api/role-slots/${slot.id}/periods`],
  });

  // Build periods to render. If no periods exist, synthesize one from slot dates.
  const periodsToRender: any[] = periods.length > 0
    ? periods
    : [{ id: null, slotId: slot.id, startDate: slot.startDate, endDate: slot.endDate, periodType: "initial", notes: null }];

  // Active assignments overlapping this period
  function assignedWorkersForPeriod(p: any): string[] {
    const names: string[] = [];
    const activeAsgs = assignments.filter(
      a => a.status === "active" || a.status === "flagged" || a.status === "confirmed" || a.status === "pending_confirmation"
    );
    for (const a of activeAsgs) {
      if (!a.startDate || !a.endDate) continue;
      if (a.startDate <= p.endDate && a.endDate >= p.startDate) {
        const worker = workers.find(w => w.id === a.workerId);
        if (worker) names.push(cleanName(worker.name));
      }
    }
    return names;
  }

  const totalFilled = assignments.filter(a =>
    a.status === "active" || a.status === "flagged" || a.status === "confirmed" || a.status === "pending_confirmation"
  ).length;

  return (
    <div
      className="flex items-stretch"
      style={{
        borderBottom: "1px solid hsl(var(--border))",
        minHeight: Math.max(48, periodsToRender.length * 32 + 16),
      }}
    >
      {/* Slot info */}
      <div
        className="flex-shrink-0 px-4 py-2.5 flex flex-col justify-center"
        style={{ width: 260, borderRight: "1px solid hsl(var(--border))" }}
      >
        <div className="text-[13px] font-semibold text-pfg-navy">
          {slotLabel(slot, allSlots)}
        </div>
        <div className="text-[11px] flex items-center gap-1.5 mt-0.5" style={{ color: "var(--pfg-steel)" }}>
          <span className={`badge ${slot.shift === "Night" ? "badge-navy" : "badge-accent"} text-[9px]`}>{slot.shift}</span>
          <span>{totalFilled}/{slot.quantity} filled</span>
        </div>
        <button
          onClick={() => onEditPeriod({
            periodId: null,
            slotId: slot.id,
            startDate: slot.startDate,
            endDate: slot.endDate,
            periodType: "remob",
            notes: "",
          })}
          className="flex items-center gap-1 text-[10px] font-semibold mt-1 self-start"
          style={{ color: "var(--teal, #005E60)" }}
        >
          <Plus className="w-3 h-3" /> Add Period
        </button>
      </div>

      {/* Gantt track */}
      <div className="flex-1 relative" style={{ padding: "8px 0" }}>
        {/* Vertical week gridlines */}
        {weekColumns.map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(i / weekColumns.length) * 100}%`,
              top: 0,
              bottom: 0,
              width: 1,
              borderLeft: i === 0 ? "none" : "1px dashed hsl(var(--border))",
              pointerEvents: "none",
            }}
          />
        ))}
        {/* Period bars */}
        <div style={{ position: "relative", height: periodsToRender.length * 32 }}>
          {periodsToRender.map((p: any, idx: number) => {
            const startFrac = dateToColumnFraction(p.startDate, weekColumns);
            const endFrac = dateToColumnFraction(p.endDate, weekColumns);
            const leftPct = (startFrac / weekColumns.length) * 100;
            const widthPct = Math.max(0.5, ((endFrac - startFrac) / weekColumns.length) * 100);
            const workerNames = assignedWorkersForPeriod(p);
            const filled = workerNames.length > 0;
            const isInitial = p.periodType === "initial";

            const bg = filled
              ? (isInitial ? "#005E60" : "#0E8286")
              : (isInitial ? "#DBEAFE" : "#FEF3C7");
            const border = filled
              ? "none"
              : "1.5px dashed #D97706";
            const textColor = filled ? "#fff" : (isInitial ? "#1D4ED8" : "#92400E");

            return (
              <div
                key={p.id ?? `synth-${idx}`}
                onClick={() => {
                  if (!p.id) {
                    // Synthesized period — can't edit, but allow adding a period
                    onEditPeriod({
                      periodId: null,
                      slotId: slot.id,
                      startDate: p.startDate,
                      endDate: p.endDate,
                      periodType: "initial",
                      notes: p.notes || "",
                    });
                    return;
                  }
                  onEditPeriod({
                    periodId: p.id,
                    slotId: slot.id,
                    startDate: p.startDate,
                    endDate: p.endDate,
                    periodType: p.periodType === "initial" ? "initial" : "remob",
                    notes: p.notes || "",
                  });
                }}
                style={{
                  position: "absolute",
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  top: idx * 32 + 4,
                  height: 22,
                  background: bg,
                  border,
                  borderRadius: 4,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 6px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: textColor,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
                title={`${isInitial ? "Initial" : "Remob"} · ${p.startDate} → ${p.endDate}${p.notes ? " · " + p.notes : ""}${workerNames.length > 0 ? " · " + workerNames.join(", ") : " · Unassigned"}`}
              >
                {filled ? workerNames.join(", ") : `Unassigned · ${isInitial ? "Initial" : "Remob"}`}
              </div>
            );
          })}
        </div>
      </div>

      {/* Action column */}
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{ width: 60, borderLeft: "1px solid hsl(var(--border))" }}
      >
        <button
          onClick={() => onDeleteSlot(slot.id)}
          disabled={deletingSlotId === slot.id}
          className="p-1.5 rounded hover:bg-[var(--red-bg)]"
          title="Delete role slot"
        >
          {deletingSlotId === slot.id ? (
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--pfg-steel)" }} />
          ) : (
            <Trash2 className="w-4 h-4" style={{ color: "var(--red)" }} />
          )}
        </button>
      </div>
    </div>
  );
}
