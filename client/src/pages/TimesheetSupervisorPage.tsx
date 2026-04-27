/**
 * Supervisor-facing Timesheet Review Page
 * Public route: /#/timesheet-supervisor/:token
 * Mobile-first: card-per-worker layout below 768px, table layout on desktop
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import { sumPaidHours } from "@shared/timesheet-hours";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SupEntry {
  id: number;
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

interface SupWeek {
  id: number;
  project_id: number;
  project_name: string;
  project_code: string;
  customer: string;
  week_commencing: string;
  status: string;
  day_sup_submitted_at: string | null;
  night_sup_submitted_at: string | null;
  day_sup_name: string | null;
  night_sup_name: string | null;
  night_sup_token: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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

function calcHours(timeIn: string | null, timeOut: string | null, breakMin: number): number | null {
  if (!timeIn || !timeOut) return null;
  const [h1, m1] = timeIn.split(":").map(Number);
  const [h2, m2] = timeOut.split(":").map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  mins -= breakMin;
  return Math.round((mins / 60) * 100) / 100;
}

function dayTypeLabel(dt: string): string {
  const map: Record<string, string> = {
    working: "Working",
    rest_day: "Rest Day",
    mob: "MOB",
    demob: "DEMOB",
    absent_sick: "Sick",
    absent_unauthorised: "Absent",
    partial_mob: "MOB (½)",
    partial_demob: "DEMOB (½)",
  };
  return map[dt] || dt;
}

function dayTypeBg(dt: string): string {
  const map: Record<string, string> = {
    working: "#f0fdf4",
    rest_day: "#f9fafb",
    mob: "#eff6ff",
    demob: "#faf5ff",
    absent_sick: "#fff7ed",
    absent_unauthorised: "#fef2f2",
    partial_mob: "#eff6ff",
    partial_demob: "#faf5ff",
  };
  return map[dt] || "#fff";
}

function dayTypeText(dt: string): string {
  const map: Record<string, string> = {
    working: "#15803d",
    rest_day: "#6b7280",
    mob: "#1d4ed8",
    demob: "#7c3aed",
    absent_sick: "#c2410c",
    absent_unauthorised: "#b91c1c",
    partial_mob: "#1d4ed8",
    partial_demob: "#7c3aed",
  };
  return map[dt] || "#111";
}

// ─── Loading / Error screens ──────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#F4F5F7" }}>
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p style={{ color: "#6b7280", fontSize: 14 }}>Loading timesheet…</p>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#F4F5F7" }}>
      <div style={{ maxWidth: 480, background: "#fff", borderRadius: 12, padding: "40px 32px", textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1A1D23", marginBottom: 8 }}>Unable to Load Timesheet</h2>
        <p style={{ color: "#6b7280", fontSize: 14 }}>{message}</p>
      </div>
    </div>
  );
}

// ─── Entry row editor (used in both mobile + desktop) ────────────────────────

function EntryEditor({
  entry,
  isLocked,
  onPatch,
}: {
  entry: SupEntry;
  isLocked: boolean;
  onPatch: (id: number, patch: object) => void;
}) {
  const [localTimeIn, setLocalTimeIn] = useState(entry.time_in?.substring(0, 5) || "");
  const [localTimeOut, setLocalTimeOut] = useState(entry.time_out?.substring(0, 5) || "");
  const [localDayType, setLocalDayType] = useState(entry.day_type);
  const breakMin = entry.unpaid_break_minutes || 60;

  // Live-calculate hours
  const computedHours = localDayType === "working"
    ? calcHours(localTimeIn, localTimeOut, breakMin)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Day type selector */}
      {!isLocked ? (
        <select
          value={localDayType}
          onChange={e => {
            setLocalDayType(e.target.value);
            onPatch(entry.id, { day_type: e.target.value });
          }}
          style={{
            fontSize: 12, padding: "4px 6px", border: "1px solid #d1d5db", borderRadius: 6,
            background: dayTypeBg(localDayType), color: dayTypeText(localDayType), fontWeight: 600,
          }}
        >
          <option value="working">Working</option>
          <option value="rest_day">Rest Day</option>
          <option value="mob">MOB</option>
          <option value="demob">DEMOB</option>
          <option value="absent_sick">Sick</option>
          <option value="absent_unauthorised">Absent</option>
          <option value="partial_mob">MOB (½)</option>
          <option value="partial_demob">DEMOB (½)</option>
        </select>
      ) : (
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20, display: "inline-block",
          background: dayTypeBg(localDayType), color: dayTypeText(localDayType),
        }}>
          {dayTypeLabel(localDayType)}
        </span>
      )}

      {/* Time in/out inputs — only show for "working" */}
      {localDayType === "working" && (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {!isLocked ? (
            <>
              <input
                type="time"
                value={localTimeIn}
                onChange={e => setLocalTimeIn(e.target.value)}
                onBlur={e => { if (e.target.value) onPatch(entry.id, { time_in: e.target.value }); }}
                style={{ fontSize: 11, width: 72, border: "1px solid #d1d5db", borderRadius: 4, padding: "2px 4px" }}
              />
              <span style={{ fontSize: 10, color: "#9ca3af" }}>–</span>
              <input
                type="time"
                value={localTimeOut}
                onChange={e => setLocalTimeOut(e.target.value)}
                onBlur={e => { if (e.target.value) onPatch(entry.id, { time_out: e.target.value }); }}
                style={{ fontSize: 11, width: 72, border: "1px solid #d1d5db", borderRadius: 4, padding: "2px 4px" }}
              />
            </>
          ) : (
            <span style={{ fontSize: 11, color: "#374151" }}>
              {entry.time_in?.substring(0, 5) || "—"} – {entry.time_out?.substring(0, 5) || "—"}
            </span>
          )}
          {computedHours !== null && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#1A1D23", marginLeft: 4 }}>
              {computedHours.toFixed(1)}h
            </span>
          )}
          {isLocked && entry.total_hours && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#1A1D23", marginLeft: 4 }}>
              {parseFloat(entry.total_hours).toFixed(1)}h
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Mobile worker card ───────────────────────────────────────────────────────

function WorkerCard({
  workerName,
  workerRole,
  entries,
  dates,
  isLocked,
  onPatch,
}: {
  workerName: string;
  workerRole: string;
  entries: SupEntry[];
  dates: string[];
  isLocked: boolean;
  onPatch: (id: number, patch: object) => void;
}) {
  const totalHours = sumPaidHours(entries);

  return (
    <div style={{
      background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb",
      overflow: "hidden", marginBottom: 12,
    }}>
      {/* Worker header */}
      <div style={{
        background: "#1A1D23", padding: "12px 16px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{workerName}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{workerRole}</div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#F5BD00" }}>
          {totalHours.toFixed(1)}h
        </div>
      </div>

      {/* Day rows */}
      <div>
        {dates.map((date, i) => {
          const entry = entries.find(e => e.entry_date?.toString().substring(0, 10) === date);
          const d = new Date(date);
          return (
            <div key={date} style={{
              padding: "10px 14px",
              borderBottom: i < 6 ? "1px solid #f3f4f6" : "none",
              display: "flex", alignItems: "flex-start", gap: 12,
              background: i % 2 === 0 ? "#fafafa" : "#fff",
            }}>
              {/* Day label */}
              <div style={{ minWidth: 52 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1D23" }}>{DAY_NAMES[i]}</div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>{d.getUTCDate()}/{d.getUTCMonth() + 1}</div>
              </div>
              {/* Entry editor or dash */}
              <div style={{ flex: 1 }}>
                {entry ? (
                  <EntryEditor entry={entry} isLocked={isLocked} onPatch={onPatch} />
                ) : (
                  <span style={{ color: "#d1d5db", fontSize: 11 }}>—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Desktop table row ────────────────────────────────────────────────────────

function DesktopTableRow({
  workerName,
  workerRole,
  entries,
  dates,
  isLocked,
  onPatch,
  isOdd,
}: {
  workerName: string;
  workerRole: string;
  entries: SupEntry[];
  dates: string[];
  isLocked: boolean;
  onPatch: (id: number, patch: object) => void;
  isOdd: boolean;
}) {
  const totalHours = sumPaidHours(entries);
  return (
    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
      <td style={{ padding: "10px 12px", background: isOdd ? "#fafafa" : "#fff", verticalAlign: "top" }}>
        <div style={{ fontWeight: 600, color: "#1A1D23", fontSize: 13 }}>{workerName}</div>
        <div style={{ color: "#6b7280", fontSize: 11 }}>{workerRole}</div>
      </td>
      {dates.map((date) => {
        const entry = entries.find(e => e.entry_date?.toString().substring(0, 10) === date);
        return (
          <td key={date} style={{ padding: "6px 4px", background: isOdd ? "#fafafa" : "#fff", verticalAlign: "top" }}>
            {entry ? (
              <EntryEditor entry={entry} isLocked={isLocked} onPatch={onPatch} />
            ) : (
              <span style={{ color: "#d1d5db", fontSize: 11 }}>—</span>
            )}
          </td>
        );
      })}
      <td style={{ textAlign: "center", fontWeight: 700, fontSize: 13, color: "#1A1D23", padding: "10px 8px", background: isOdd ? "#fafafa" : "#fff" }}>
        {totalHours.toFixed(1)}h
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TimesheetSupervisorPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const qc = useQueryClient();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: fetchError } = useQuery({
    queryKey: ["timesheet-supervisor", token],
    queryFn: async () => {
      const res = await fetch(`/api/timesheet-supervisor/${token}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to load" }));
        throw new Error(err.error || "Failed to load");
      }
      return res.json() as Promise<{
        week: SupWeek;
        shift: "day" | "night";
        supervisor_name: string;
        entries: SupEntry[];
      }>;
    },
    retry: false,
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) =>
      apiRequest("PATCH", `/api/timesheet-entries/${id}`, patch).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheet-supervisor", token] });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/timesheet-supervisor/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Submit failed" }));
        throw new Error(err.error || "Submit failed");
      }
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
    onError: (e: any) => setError(e.message),
  });

  if (isLoading) return <LoadingScreen />;
  if (fetchError) return <ErrorScreen message={(fetchError as Error).message} />;
  if (!data) return <ErrorScreen message="No data found" />;

  const { week, shift, supervisor_name, entries } = data;
  const shiftLabel = shift === "night" ? "Night" : "Day";
  const submittedAt = shift === "day" ? week.day_sup_submitted_at : week.night_sup_submitted_at;
  const isAlreadySubmitted = !!submittedAt || submitted;
  const isLocked = isAlreadySubmitted || week.status === "customer_approved";

  const dates = weekDates(week.week_commencing);

  // Build worker map
  const workerMap = new Map<number, { name: string; role: string; entries: SupEntry[] }>();
  for (const e of entries) {
    if (!workerMap.has(e.worker_id)) {
      workerMap.set(e.worker_id, { name: e.worker_name, role: e.worker_role, entries: [] });
    }
    workerMap.get(e.worker_id)!.entries.push(e);
  }

  const handlePatch = (id: number, patch: object) => {
    patchMutation.mutate({ id, patch });
  };

  // Submitted confirmation screen
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F4F5F7" }}>
        <div style={{ maxWidth: 480, background: "#fff", borderRadius: 12, padding: "40px 32px", textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
          <div style={{ width: 64, height: 64, background: "#dcfce7", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1A1D23", marginBottom: 8 }}>Timesheet Submitted</h2>
          <p style={{ color: "#6b7280", fontSize: 14, lineHeight: 1.6 }}>
            Thank you, <strong>{supervisor_name}</strong>. Your {shiftLabel} Shift timesheet for{" "}
            <strong>{week.project_name}</strong> has been submitted. Your project manager has been notified.
          </p>
          <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 16 }}>
            Week commencing {fmtDate(week.week_commencing)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#F4F5F7" }}>
      {/* Header */}
      <div style={{
        background: "#1A1D23", padding: "0 20px", height: 60,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <img src="/logo-gold.png" alt="Powerforce Global" style={{ height: 32 }} />
        <span style={{
          color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.1em", textTransform: "uppercase",
        }}>
          Timesheet Review
        </span>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 40px" }}>
        {/* Project header card */}
        <div style={{
          background: "#fff", borderRadius: 12, padding: "20px 24px", marginBottom: 16,
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1A1D23", margin: 0 }}>{week.project_name}</h1>
              <p style={{ color: "#6b7280", fontSize: 13, margin: "4px 0 0" }}>
                {week.project_code} &middot; {week.customer || ""}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>Week commencing</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1A1D23" }}>{fmtDate(week.week_commencing)}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
            <span style={{
              fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20,
              background: shift === "night" ? "#1e1b4b" : "#dbeafe",
              color: shift === "night" ? "#c7d2fe" : "#1d4ed8",
            }}>
              {shiftLabel} Shift
            </span>
            <span style={{ fontSize: 13, color: "#374151", fontWeight: 600, padding: "4px 0" }}>
              {supervisor_name}
            </span>
          </div>
        </div>

        {/* Status banner — already submitted */}
        {isAlreadySubmitted && submittedAt && (
          <div style={{
            background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10,
            padding: "14px 18px", marginBottom: 16,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>
              You submitted this timesheet on {fmtDateTime(submittedAt)}. Thank you.
            </span>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
            padding: "12px 16px", marginBottom: 16, color: "#b91c1c", fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {entries.length === 0 ? (
          <div style={{
            background: "#fff", borderRadius: 10, padding: "48px 24px", textAlign: "center",
            color: "#9ca3af", fontSize: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
          }}>
            No timesheet entries found for the {shiftLabel} shift this week.
          </div>
        ) : (
          <>
            {/* Mobile layout (≤768px): card per worker */}
            <div className="block md:hidden">
              {Array.from(workerMap.values()).map((worker) => (
                <WorkerCard
                  key={worker.name}
                  workerName={worker.name}
                  workerRole={worker.role}
                  entries={worker.entries}
                  dates={dates}
                  isLocked={isLocked}
                  onPatch={handlePatch}
                />
              ))}
            </div>

            {/* Desktop layout (>768px): table */}
            <div className="hidden md:block">
              <div style={{
                background: "#fff", borderRadius: 10, overflow: "hidden",
                boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16,
              }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#1A1D23" }}>
                        <th style={{ textAlign: "left", padding: "10px 12px", color: "#fff", fontWeight: 700, fontSize: 11, minWidth: 160 }}>
                          WORKER
                        </th>
                        {dates.map((date, i) => {
                          const d = new Date(date);
                          return (
                            <th key={date} style={{ textAlign: "center", padding: "10px 6px", color: "#F5BD00", fontWeight: 700, fontSize: 11, minWidth: 120 }}>
                              <div>{DAY_NAMES[i]}</div>
                              <div style={{ color: "rgba(255,255,255,0.6)", fontWeight: 400, fontSize: 10 }}>
                                {d.getUTCDate()}/{d.getUTCMonth() + 1}
                              </div>
                            </th>
                          );
                        })}
                        <th style={{ textAlign: "center", padding: "10px 8px", color: "#F5BD00", fontWeight: 700, fontSize: 11, minWidth: 70 }}>
                          TOTAL
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(workerMap.values()).map((worker, wi) => (
                        <DesktopTableRow
                          key={worker.name}
                          workerName={worker.name}
                          workerRole={worker.role}
                          entries={worker.entries}
                          dates={dates}
                          isLocked={isLocked}
                          onPatch={handlePatch}
                          isOdd={wi % 2 !== 0}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Submit button */}
        {!isLocked && entries.length > 0 && (
          <div style={{ padding: "16px 0 8px" }}>
            <button
              onClick={() => {
                setError(null);
                submitMutation.mutate();
              }}
              disabled={submitMutation.isPending}
              data-testid="button-submit-timesheet"
              style={{
                width: "100%", background: "#1A1D23", color: "#F5BD00",
                fontWeight: 700, fontSize: 15, padding: "14px 24px",
                borderRadius: 10, border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: submitMutation.isPending ? 0.7 : 1,
                boxShadow: "0 4px 12px rgba(26,29,35,0.3)",
              }}
            >
              {submitMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Submit {shiftLabel} Shift Timesheet
                </>
              )}
            </button>
            <p style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
              Once submitted, you will not be able to make further changes.
            </p>
          </div>
        )}

        {/* Footer */}
        <p style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", marginTop: 24 }}>
          &copy; {new Date().getFullYear()} Powerforce Global &middot; Confidential
        </p>
      </div>
    </div>
  );
}
