/**
 * Timesheet Module — Project Tab
 * Steps 1–7: Config, Auto-build, Supervisor Review, PM Approval, Customer Sign-off,
 *            PDF Generation, Billing Summary
 */

import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { DashboardProject } from "@/hooks/use-dashboard-data";
import {
  Settings, Clock, CheckCircle2, Send, Download, RotateCcw,
  ChevronRight, AlertCircle, Loader2, Users, Calendar, FileText,
  X, Check, Info
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TimesheetConfig {
  id: number;
  project_id: number;
  day_shift_start: string;
  day_shift_end: string;
  night_shift_start: string;
  night_shift_end: string;
  unpaid_break_minutes: number;
  working_days: string[];
  customer_signoff_required: boolean;
}

interface TimesheetWeek {
  id: number;
  project_id: number;
  week_commencing: string;
  status: string;
  submitted_at: string | null;
  pm_approved_at: string | null;
  customer_approved_at: string | null;
  approval_name: string | null;
  approval_email: string | null;
  approval_hash: string | null;
  timesheet_pdf_path: string | null;
  billing_pdf_path: string | null;
  pm_reject_comment: string | null;
  customer_challenge: string | null;
  // Supervisor flow fields
  day_sup_token: string | null;
  day_sup_submitted_at: string | null;
  night_sup_token: string | null;
  night_sup_submitted_at: string | null;
  day_sup_name: string | null;
  night_sup_name: string | null;
}

interface TimesheetEntry {
  id: number;
  timesheet_week_id: number;
  worker_id: number;
  worker_name: string;
  worker_role: string;
  entry_date: string;
  shift: string;
  time_in: string | null;
  time_out: string | null;
  unpaid_break_minutes: number;
  day_type: string;
  total_hours: string | null;
  supervisor_note: string | null;
  is_override: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAYS = ["mon","tue","wed","thu","fri","sat","sun"];
const DAY_LABELS: Record<string, string> = { mon:"Mon", tue:"Tue", wed:"Wed", thu:"Thu", fri:"Fri", sat:"Sat", sun:"Sun" };
const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

function weekDates(weekComm: string): string[] {
  const d = new Date(weekComm);
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(d);
    dd.setUTCDate(dd.getUTCDate() + i);
    return dd.toISOString().split("T")[0];
  });
}

function calcWeeklyHours(config: Partial<TimesheetConfig>): number {
  const days = config.working_days?.length ?? 6;
  const start = config.day_shift_start || "07:00";
  const end = config.day_shift_end || "19:00";
  const [h1, m1] = start.split(":").map(Number);
  const [h2, m2] = end.split(":").map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  mins -= (config.unpaid_break_minutes || 60);
  return Math.round((days * mins / 60) * 10) / 10;
}

function statusBadge(status: string, week?: TimesheetWeek) {
  // Compute enriched label based on supervisor submission state
  let label = "Draft";
  let bg = "#f3f4f6";
  let text = "#6b7280";

  if (status === "draft" && week) {
    const hasNightSup = !!week.night_sup_token;
    const dayDone = !!week.day_sup_submitted_at;
    const nightDone = !!week.night_sup_submitted_at;
    if (hasNightSup && dayDone && !nightDone) {
      label = "Partial — 1/2 shifts in";
      bg = "#fff3cd"; text = "#856404";
    } else if (hasNightSup && !dayDone && nightDone) {
      label = "Partial — 1/2 shifts in";
      bg = "#fff3cd"; text = "#856404";
    } else if (!dayDone && !nightDone) {
      label = "Not Started";
      bg = "#f3f4f6"; text = "#6b7280";
    } else {
      label = "Draft";
    }
  } else {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      draft: { bg: "#f3f4f6", text: "#6b7280", label: "Draft" },
      submitted: { bg: "#dbeafe", text: "#1d4ed8", label: "Ready for PM Review" },
      pm_approved: { bg: "#fef3c7", text: "#d97706", label: "PM Approved" },
      sent_to_customer: { bg: "#ede9fe", text: "#7c3aed", label: "Sent to Customer" },
      customer_approved: { bg: "#dcfce7", text: "#15803d", label: "Customer Approved" },
      recalled: { bg: "#fee2e2", text: "#b91c1c", label: "Recalled" },
    };
    const s = map[status] || map.draft;
    label = s.label; bg = s.bg; text = s.text;
  }

  return (
    <span style={{ background: bg, color: text, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20 }}>
      {label}
    </span>
  );
}

// ─── Shift Status Tiles ──────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function ShiftStatusTiles({ week }: { week: TimesheetWeek }) {
  const hasNightSup = !!week.night_sup_token;

  const TileIcon = ({ submitted }: { submitted: boolean }) => (
    submitted
      ? <CheckCircle2 className="w-4 h-4" style={{ color: "#16a34a" }} />
      : <Clock className="w-4 h-4" style={{ color: "#d97706" }} />
  );

  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
      {/* Day shift tile */}
      <div style={{
        flex: 1, minWidth: 180, background: week.day_sup_submitted_at ? "#f0fdf4" : "#fffbeb",
        borderRadius: 8, padding: "12px 14px",
        border: `1px solid ${week.day_sup_submitted_at ? "#bbf7d0" : "#fde68a"}`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <TileIcon submitted={!!week.day_sup_submitted_at} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1D23" }}>Day Shift</div>
          {week.day_sup_submitted_at ? (
            <div style={{ fontSize: 11, color: "#15803d" }}>Submitted {fmtDateTime(week.day_sup_submitted_at)}</div>
          ) : (
            <div style={{ fontSize: 11, color: "#d97706" }}>Pending{week.day_sup_name ? ` — ${week.day_sup_name}` : ""}</div>
          )}
        </div>
      </div>

      {/* Night shift tile */}
      {hasNightSup ? (
        <div style={{
          flex: 1, minWidth: 180, background: week.night_sup_submitted_at ? "#f0fdf4" : "#fffbeb",
          borderRadius: 8, padding: "12px 14px",
          border: `1px solid ${week.night_sup_submitted_at ? "#bbf7d0" : "#fde68a"}`,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <TileIcon submitted={!!week.night_sup_submitted_at} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1D23" }}>Night Shift</div>
            {week.night_sup_submitted_at ? (
              <div style={{ fontSize: 11, color: "#15803d" }}>Submitted {fmtDateTime(week.night_sup_submitted_at)}</div>
            ) : (
              <div style={{ fontSize: 11, color: "#d97706" }}>Pending{week.night_sup_name ? ` — ${week.night_sup_name}` : ""}</div>
            )}
          </div>
        </div>
      ) : (
        <div style={{
          flex: 1, minWidth: 180, background: "#f9fafb",
          borderRadius: 8, padding: "12px 14px",
          border: "1px solid #e5e7eb",
          display: "flex", alignItems: "center", gap: 10, opacity: 0.7,
        }}>
          <Info className="w-4 h-4" style={{ color: "#9ca3af" }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280" }}>Night Shift</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>N/A — no night supervisor</div>
          </div>
        </div>
      )}
    </div>
  );
}

function dayTypeLabel(dt: string): string {
  const map: Record<string, string> = {
    working: "Work", rest_day: "Rest", mob: "MOB", demob: "DEMOB",
    absent_sick: "Sick", absent_unauthorised: "Absent", partial_mob: "MOB½", partial_demob: "DEM½",
  };
  return map[dt] || dt;
}

function dayTypeBg(dt: string): string {
  return {
    working: "#f0fdf4", rest_day: "#f9fafb", mob: "#eff6ff", demob: "#faf5ff",
    absent_sick: "#fff7ed", absent_unauthorised: "#fef2f2",
    partial_mob: "#eff6ff", partial_demob: "#faf5ff",
  }[dt] || "#fff";
}

function dayTypeColor(dt: string): string {
  return {
    working: "#15803d", rest_day: "#9ca3af", mob: "#1d4ed8", demob: "#7c3aed",
    absent_sick: "#c2410c", absent_unauthorised: "#b91c1c",
    partial_mob: "#1d4ed8", partial_demob: "#7c3aed",
  }[dt] || "#111";
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--pfg-navy, #1A1D23)", margin: 0 }}>{title}</h3>
      {action}
    </div>
  );
}

// ─── Configuration Panel (Step 1) ────────────────────────────────────────────

function ConfigPanel({ project, onSaved, existingConfig }: {
  project: DashboardProject;
  onSaved: () => void;
  existingConfig: TimesheetConfig | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    day_shift_start: existingConfig?.day_shift_start || "07:00",
    day_shift_end: existingConfig?.day_shift_end || "19:00",
    night_shift_start: existingConfig?.night_shift_start || "19:00",
    night_shift_end: existingConfig?.night_shift_end || "07:00",
    unpaid_break_minutes: existingConfig?.unpaid_break_minutes || 60,
    working_days: existingConfig?.working_days || ["mon","tue","wed","thu","fri","sat"],
    customer_signoff_required: existingConfig?.customer_signoff_required !== false,
  });

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${project.id}/timesheet-config`, form).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheet-config", project.id] });
      qc.invalidateQueries({ queryKey: ["timesheet-weeks", project.id] });
      toast({ title: "Timesheet config saved", description: "Auto-build running in background…" });
      onSaved();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const weeklyHours = calcWeeklyHours(form);

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "24px", border: "1px solid hsl(var(--border))" }}>
      <SectionHeader title="Timesheet Configuration" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Day Shift */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Day Shift Start</label>
          <input type="time" value={form.day_shift_start}
            onChange={e => setForm(f => ({ ...f, day_shift_start: e.target.value }))}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Day Shift End</label>
          <input type="time" value={form.day_shift_end}
            onChange={e => setForm(f => ({ ...f, day_shift_end: e.target.value }))}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} />
        </div>
        {/* Night Shift */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Night Shift Start</label>
          <input type="time" value={form.night_shift_start}
            onChange={e => setForm(f => ({ ...f, night_shift_start: e.target.value }))}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Night Shift End</label>
          <input type="time" value={form.night_shift_end}
            onChange={e => setForm(f => ({ ...f, night_shift_end: e.target.value }))}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} />
        </div>
        {/* Unpaid Break */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Unpaid Break</label>
          <div style={{ display: "flex", gap: 16 }}>
            {[30, 60].map(min => (
              <label key={min} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
                <input type="radio" checked={form.unpaid_break_minutes === min}
                  onChange={() => setForm(f => ({ ...f, unpaid_break_minutes: min }))} />
                {min} min
              </label>
            ))}
          </div>
        </div>
        {/* Weekly Hours (read-only) */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Calculated Weekly Hours</label>
          <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: 6, fontSize: 13, fontWeight: 700, color: "var(--pfg-navy, #1A1D23)", border: "1px solid #e5e7eb" }}>
            {weeklyHours}h
          </div>
        </div>
      </div>

      {/* Working Days */}
      <div style={{ marginTop: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 }}>Working Days</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {DAYS.map(d => (
            <label key={d} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 13 }}>
              <input type="checkbox" checked={form.working_days.includes(d)}
                onChange={e => setForm(f => ({
                  ...f,
                  working_days: e.target.checked
                    ? [...f.working_days, d]
                    : f.working_days.filter(x => x !== d),
                }))} />
              {DAY_LABELS[d]}
            </label>
          ))}
        </div>
      </div>

      {/* Customer Sign-off */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <div
            onClick={() => setForm(f => ({ ...f, customer_signoff_required: !f.customer_signoff_required }))}
            style={{
              width: 40, height: 22, borderRadius: 11, position: "relative", cursor: "pointer",
              background: form.customer_signoff_required ? "var(--pfg-yellow, #F5BD00)" : "#d1d5db",
              transition: "background 0.2s",
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: "50%", background: "#fff",
              position: "absolute", top: 2, left: form.customer_signoff_required ? 20 : 2,
              transition: "left 0.2s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Customer Sign-off Required</span>
        </label>
      </div>

      <div style={{ marginTop: 20 }}>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          style={{
            background: "var(--pfg-navy, #1A1D23)", color: "#fff", fontWeight: 700, fontSize: 13,
            padding: "10px 24px", borderRadius: 8, border: "none", cursor: "pointer",
            opacity: saveMutation.isPending ? 0.7 : 1, display: "flex", alignItems: "center", gap: 8,
          }}
        >
          {saveMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Settings className="w-4 h-4" /> Save & Build Timesheets</>}
        </button>
      </div>
    </div>
  );
}

// ─── Week List ────────────────────────────────────────────────────────────────

function WeekList({ weeks, onSelect, selectedId }: {
  weeks: TimesheetWeek[];
  onSelect: (w: TimesheetWeek) => void;
  selectedId: number | null;
}) {
  if (weeks.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "32px 0", color: "#9ca3af", fontSize: 13 }}>
        No timesheet weeks yet. Save configuration to generate them.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {weeks.map(w => (
        <div
          key={w.id}
          onClick={() => onSelect(w)}
          style={{
            padding: "12px 16px", borderRadius: 10, border: `1px solid ${selectedId === w.id ? "var(--pfg-yellow, #F5BD00)" : "hsl(var(--border))"}`,
            background: selectedId === w.id ? "#fffbeb" : "#fff",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--pfg-navy, #1A1D23)" }}>
              w/c {fmtDate(w.week_commencing)}
            </div>
            {w.pm_reject_comment && (
              <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 2 }}>
                Rejected: {w.pm_reject_comment.substring(0, 60)}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {statusBadge(w.status, w)}
            <ChevronRight className="w-4 h-4" style={{ color: "#9ca3af" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Supervisor Grid (Step 3) ─────────────────────────────────────────────────

function SupervisorGrid({ week, entries, userRole, onRefresh }: {
  week: TimesheetWeek;
  entries: TimesheetEntry[];
  userRole: string;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editCell, setEditCell] = useState<{ entryId: number; field: string } | null>(null);

  const isLocked = week.status === "customer_approved" || week.status === "submitted" || week.status === "pm_approved" || week.status === "sent_to_customer";

  const patchMutation = useMutation({
    mutationFn: (data: { id: number; patch: object }) =>
      apiRequest("PATCH", `/api/timesheet-entries/${data.id}`, data.patch).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheet-entries", week.id] });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  // Build worker map
  const workerMap = new Map<number, { name: string; role: string; entries: TimesheetEntry[] }>();
  for (const e of entries) {
    if (!workerMap.has(e.worker_id)) {
      workerMap.set(e.worker_id, { name: e.worker_name, role: e.worker_role, entries: [] });
    }
    workerMap.get(e.worker_id)!.entries.push(e);
  }

  const dates = weekDates(week.week_commencing);

  const updateEntry = useCallback((entry: TimesheetEntry, patch: object) => {
    patchMutation.mutate({ id: entry.id, patch });
  }, [patchMutation]);

  return (
    <div>
      <SectionHeader
        title={`Weekly Timesheet — w/c ${fmtDate(week.week_commencing)}`}
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {statusBadge(week.status, week)}
            {week.pm_reject_comment && (
              <span style={{ fontSize: 11, color: "#b91c1c", background: "#fef2f2", padding: "2px 8px", borderRadius: 6 }}>
                Rejected: {week.pm_reject_comment.substring(0, 50)}
              </span>
            )}
          </div>
        }
      />

      <ShiftStatusTiles week={week} />

      <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid hsl(var(--border))", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--pfg-navy, #1A1D23)" }}>
              <th style={{ textAlign: "left", padding: "10px 12px", color: "#fff", fontWeight: 700, fontSize: 11, minWidth: 160 }}>WORKER</th>
              {dates.map((date, i) => {
                const d = new Date(date);
                return (
                  <th key={date} style={{ textAlign: "center", padding: "10px 4px", color: "#F5BD00", fontWeight: 700, fontSize: 11, minWidth: 100 }}>
                    <div>{DAY_NAMES[i]}</div>
                    <div style={{ color: "rgba(255,255,255,0.6)", fontWeight: 400, fontSize: 10 }}>{d.getUTCDate()}/{d.getUTCMonth() + 1}</div>
                  </th>
                );
              })}
              <th style={{ textAlign: "center", padding: "10px 6px", color: "#F5BD00", fontWeight: 700, fontSize: 11, minWidth: 60 }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(workerMap.values()).map((worker, wi) => {
              const totalHours = worker.entries.reduce((sum, e) => sum + (parseFloat(e.total_hours || "0") || 0), 0);
              return (
                <tr key={wi} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                  <td style={{ padding: "10px 12px", background: wi % 2 === 0 ? "hsl(var(--muted))" : "#fff" }}>
                    <div style={{ fontWeight: 600, color: "var(--pfg-navy, #1A1D23)", fontSize: 12 }}>{worker.name}</div>
                    <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 11 }}>{worker.role}</div>
                  </td>
                  {dates.map((date) => {
                    const entry = worker.entries.find(e => e.entry_date?.toString().substring(0, 10) === date);
                    if (!entry) {
                      return <td key={date} style={{ textAlign: "center", padding: "8px 4px" }}>
                        <span style={{ color: "#d1d5db", fontSize: 11 }}>—</span>
                      </td>;
                    }
                    return (
                      <td key={date} style={{ background: dayTypeBg(entry.day_type), padding: "4px", verticalAlign: "top" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: dayTypeColor(entry.day_type), textAlign: "center", marginBottom: 2 }}>
                          {dayTypeLabel(entry.day_type)}
                          {entry.is_override && <span title="Manually edited" style={{ color: "#d97706", marginLeft: 2 }}>✎</span>}
                        </div>
                        {entry.day_type === "working" && (
                          <div style={{ fontSize: 10, textAlign: "center", color: "#374151" }}>
                            {entry.time_in?.substring(0, 5) || "—"}–{entry.time_out?.substring(0, 5) || "—"}
                          </div>
                        )}
                        {entry.total_hours && entry.day_type === "working" && (
                          <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700 }}>
                            {parseFloat(entry.total_hours).toFixed(1)}h
                          </div>
                        )}
                        {!isLocked && (
                          <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 4, flexWrap: "wrap" }}>
                            {/* Day type selector */}
                            <select
                              value={entry.day_type}
                              onChange={e => updateEntry(entry, { day_type: e.target.value })}
                              style={{ fontSize: 9, padding: "1px 2px", border: "1px solid #e5e7eb", borderRadius: 3, maxWidth: 80 }}
                            >
                              <option value="working">Working</option>
                              <option value="rest_day">Rest Day</option>
                              <option value="mob">MOB</option>
                              <option value="demob">DEMOB</option>
                              <option value="absent_sick">Sick</option>
                              <option value="absent_unauthorised">Absent</option>
                              <option value="partial_mob">MOB½</option>
                              <option value="partial_demob">DEM½</option>
                            </select>
                          </div>
                        )}
                        {!isLocked && entry.day_type === "working" && (
                          <div style={{ display: "flex", gap: 1, justifyContent: "center", marginTop: 2 }}>
                            <input type="time" defaultValue={entry.time_in?.substring(0, 5) || ""}
                              onBlur={e => { if (e.target.value) updateEntry(entry, { time_in: e.target.value }); }}
                              style={{ fontSize: 9, width: 60, border: "1px solid #e5e7eb", borderRadius: 3, padding: "1px" }} />
                            <input type="time" defaultValue={entry.time_out?.substring(0, 5) || ""}
                              onBlur={e => { if (e.target.value) updateEntry(entry, { time_out: e.target.value }); }}
                              style={{ fontSize: 9, width: 60, border: "1px solid #e5e7eb", borderRadius: 3, padding: "1px" }} />
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: "center", fontWeight: 700, fontSize: 13, color: "var(--pfg-navy, #1A1D23)", padding: "8px 6px", background: wi % 2 === 0 ? "hsl(var(--muted))" : "#fff" }}>
                    {totalHours.toFixed(1)}h
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Submit button removed — supervisors submit via their emailed links */}
    </div>
  );
}

// ─── PM Approval Panel (Step 4) ───────────────────────────────────────────────

function PmApprovalPanel({ week, entries, onRefresh }: {
  week: TimesheetWeek;
  entries: TimesheetEntry[];
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rejectComment, setRejectComment] = useState("");
  const [showReject, setShowReject] = useState(false);

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/timesheet-weeks/${week.id}/approve`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Timesheet approved", description: "Ready to send to customer or outputs generated." });
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/timesheet-weeks/${week.id}/reject`, { comment: rejectComment }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Timesheet rejected", description: "Supervisor has been notified." });
      setShowReject(false);
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const sendToCustomerMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/timesheet-weeks/${week.id}/send-to-customer`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Sent to customer", description: "Approval email sent." });
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const recallMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/timesheet-weeks/${week.id}/recall`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Recalled", description: "Timesheet returned to draft." });
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Recall failed", description: e.message, variant: "destructive" }),
  });

  // Summary stats
  const workerIds = Array.from(new Set(entries.map(e => e.worker_id)));
  const totalHours = entries.reduce((sum, e) => sum + (parseFloat(e.total_hours || "0") || 0), 0);
  const mobCount = entries.filter(e => e.day_type === "mob" || e.day_type === "partial_mob").length;
  const demobCount = entries.filter(e => e.day_type === "demob" || e.day_type === "partial_demob").length;
  const sickCount = entries.filter(e => e.day_type === "absent_sick").length;

  return (
    <div>
      <SectionHeader
        title={`PM Review — w/c ${fmtDate(week.week_commencing)}`}
        action={statusBadge(week.status)}
      />

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Workers", value: workerIds.length, icon: <Users className="w-4 h-4" /> },
          { label: "Total Hours", value: `${totalHours.toFixed(1)}h`, icon: <Clock className="w-4 h-4" /> },
          { label: "MOB / DEMOB", value: `${mobCount} / ${demobCount}`, icon: <Calendar className="w-4 h-4" /> },
          { label: "Sick Days", value: sickCount, icon: <AlertCircle className="w-4 h-4" /> },
        ].map((card, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 8, padding: "14px 16px", border: "1px solid hsl(var(--border))" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "hsl(var(--muted-foreground))", marginBottom: 6 }}>
              {card.icon}
              <span style={{ fontSize: 11, fontWeight: 600 }}>{card.label}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--pfg-navy, #1A1D23)" }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Challenge notice */}
      {week.customer_challenge && (
        <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#92400e" }}>
          <strong>Customer Challenge:</strong> {week.customer_challenge}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {(week.status === "submitted" || !!week.day_sup_submitted_at) && week.status !== "pm_approved" && week.status !== "sent_to_customer" && week.status !== "customer_approved" && (
          <>
            <button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              style={{ background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 13, padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Approve
            </button>
            <button
              onClick={() => setShowReject(true)}
              style={{ background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 13, padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              <X className="w-4 h-4" /> Reject
            </button>
          </>
        )}
        {week.status === "pm_approved" && (
          <button
            onClick={() => sendToCustomerMutation.mutate()}
            disabled={sendToCustomerMutation.isPending}
            style={{ background: "#7c3aed", color: "#fff", fontWeight: 700, fontSize: 13, padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            {sendToCustomerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send to Customer
          </button>
        )}
        {(week.status === "sent_to_customer" || week.status === "pm_approved") && (
          <button
            onClick={() => recallMutation.mutate()}
            disabled={recallMutation.isPending}
            style={{ background: "transparent", color: "#6b7280", fontWeight: 600, fontSize: 13, padding: "10px 16px", borderRadius: 8, border: "1px solid #d1d5db", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <RotateCcw className="w-4 h-4" /> Recall
          </button>
        )}
        {week.status === "customer_approved" && (
          <div style={{ display: "flex", gap: 10 }}>
            <a href={`/api/timesheet-weeks/${week.id}/pdf`} download
              style={{ background: "var(--pfg-navy, #1A1D23)", color: "#fff", fontWeight: 700, fontSize: 13, padding: "10px 20px", borderRadius: 8, textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
              <Download className="w-4 h-4" /> Signed Timesheet PDF
            </a>
            <a href={`/api/timesheet-weeks/${week.id}/billing-pdf`} download
              style={{ background: "#1d4ed8", color: "#fff", fontWeight: 700, fontSize: 13, padding: "10px 20px", borderRadius: 8, textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
              <FileText className="w-4 h-4" /> Billing Summary PDF
            </a>
          </div>
        )}
      </div>

      {/* Reject modal */}
      {showReject && (
        <div style={{ marginTop: 16, background: "#fef2f2", borderRadius: 8, padding: "16px", border: "1px solid #fecaca" }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
            Rejection Comment (required)
          </label>
          <textarea
            value={rejectComment}
            onChange={e => setRejectComment(e.target.value)}
            rows={3}
            placeholder="Describe the issue…"
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #fca5a5", borderRadius: 6, fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={() => {
                if (!rejectComment.trim()) {
                  toast({ title: "Comment required", variant: "destructive" });
                  return;
                }
                rejectMutation.mutate();
              }}
              disabled={rejectMutation.isPending}
              style={{ background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 13, padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer" }}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Confirm Rejection"}
            </button>
            <button
              onClick={() => setShowReject(false)}
              style={{ background: "transparent", color: "#6b7280", fontWeight: 600, fontSize: 13, padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main TimesheetHub ────────────────────────────────────────────────────────

interface TimesheetHubProps {
  project: DashboardProject;
  userRole: string;
}

export default function TimesheetHub({ project, userRole }: TimesheetHubProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<"config" | "list">("list");

  const canEdit = ["admin", "resource_manager", "project_manager"].includes(userRole);

  // Fetch config
  const { data: config, isLoading: cfgLoading } = useQuery<TimesheetConfig | null>({
    queryKey: ["timesheet-config", project.id],
    queryFn: () => apiRequest("GET", `/api/projects/${project.id}/timesheet-config`).then(r => r.json()),
  });

  // Fetch weeks
  const { data: weeks = [], isLoading: weeksLoading, refetch: refetchWeeks } = useQuery<TimesheetWeek[]>({
    queryKey: ["timesheet-weeks", project.id],
    queryFn: () => apiRequest("GET", `/api/projects/${project.id}/timesheet-weeks`).then(r => r.json()),
  });

  // Fetch selected week entries
  const { data: entries = [], isLoading: entriesLoading, refetch: refetchEntries } = useQuery<TimesheetEntry[]>({
    queryKey: ["timesheet-entries", selectedWeekId],
    queryFn: () => apiRequest("GET", `/api/timesheet-weeks/${selectedWeekId}/entries`).then(r => r.json()),
    enabled: !!selectedWeekId,
  });

  const selectedWeek = weeks.find(w => w.id === selectedWeekId) || null;

  const handleRefresh = useCallback(() => {
    refetchWeeks();
    if (selectedWeekId) refetchEntries();
  }, [refetchWeeks, refetchEntries, selectedWeekId]);

  if (cfgLoading || weeksLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--pfg-navy, #1A1D23)" }} />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, minHeight: 400 }}>
      {/* Left panel — week list */}
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setActiveView("list")}
            style={{
              flex: 1, fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 6, border: "none", cursor: "pointer",
              background: activeView === "list" ? "var(--pfg-navy, #1A1D23)" : "hsl(var(--muted))",
              color: activeView === "list" ? "#fff" : "hsl(var(--muted-foreground))",
            }}
          >
            Weeks
          </button>
          {canEdit && (
            <button
              onClick={() => setActiveView("config")}
              style={{
                flex: 1, fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                background: activeView === "config" ? "var(--pfg-navy, #1A1D23)" : "hsl(var(--muted))",
                color: activeView === "config" ? "#fff" : "hsl(var(--muted-foreground))",
              }}
            >
              <Settings className="w-3.5 h-3.5 inline mr-1" />
              Config
            </button>
          )}
        </div>

        {activeView === "config" && canEdit ? (
          <ConfigPanel
            project={project}
            onSaved={() => { setActiveView("list"); handleRefresh(); }}
            existingConfig={config || null}
          />
        ) : (
          <>
            {config && (
              <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, border: "1px solid #bbf7d0" }}>
                <div style={{ fontWeight: 600, color: "#15803d", marginBottom: 4 }}>
                  <Check className="w-3.5 h-3.5 inline mr-1" /> Timesheet Configured
                </div>
                <div style={{ color: "#166534" }}>
                  Day: {config.day_shift_start?.substring(0, 5)}–{config.day_shift_end?.substring(0, 5)} · Break: {config.unpaid_break_minutes}min<br />
                  {config.working_days?.length} working days/week
                </div>
              </div>
            )}
            <WeekList
              weeks={weeks}
              onSelect={w => { setSelectedWeekId(w.id); setActiveView("list"); }}
              selectedId={selectedWeekId}
            />
          </>
        )}
      </div>

      {/* Right panel — week detail */}
      <div>
        {!selectedWeek && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, background: "#fff", borderRadius: 12, border: "1px solid hsl(var(--border))" }}>
            <div style={{ textAlign: "center", color: "hsl(var(--muted-foreground))" }}>
              <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p style={{ fontSize: 14 }}>Select a week to view</p>
              {!config && canEdit && (
                <p style={{ fontSize: 12, marginTop: 8 }}>
                  Start by saving your{" "}
                  <button onClick={() => setActiveView("config")} style={{ color: "var(--pfg-navy, #1A1D23)", fontWeight: 600, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                    timesheet configuration
                  </button>
                </p>
              )}
            </div>
          </div>
        )}

        {selectedWeek && (
          <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid hsl(var(--border))" }}>
            {entriesLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--pfg-navy, #1A1D23)" }} />
              </div>
            ) : (
              <>
                {/* Show PM panel for submitted/pm_approved/sent/approved weeks */}
                {(selectedWeek.status === "submitted" || selectedWeek.status === "pm_approved" || selectedWeek.status === "sent_to_customer" || selectedWeek.status === "customer_approved") && canEdit ? (
                  <PmApprovalPanel
                    week={selectedWeek}
                    entries={entries}
                    onRefresh={handleRefresh}
                  />
                ) : null}

                {/* Always show the grid (read-only if locked) */}
                <div style={{ marginTop: (selectedWeek.status === "submitted" || selectedWeek.status === "pm_approved" || selectedWeek.status === "sent_to_customer" || selectedWeek.status === "customer_approved") && canEdit ? 24 : 0 }}>
                  <SupervisorGrid
                    week={selectedWeek}
                    entries={entries}
                    userRole={userRole}
                    onRefresh={handleRefresh}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
