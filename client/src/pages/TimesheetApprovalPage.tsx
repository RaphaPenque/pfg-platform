/**
 * Customer-facing Timesheet Approval Page
 * Public route: /#/timesheet-approval/:token
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface TimesheetEntry {
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

interface TimesheetWeek {
  id: number;
  project_id: number;
  project_name: string;
  project_code: string;
  customer: string;
  week_commencing: string;
  status: string;
  approval_hash: string;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

function dayTypeLabel(dt: string): string {
  const map: Record<string, string> = {
    working: "Work",
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

export default function TimesheetApprovalPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [approverName, setApproverName] = useState("");
  const [approverEmail, setApproverEmail] = useState("");
  const [challengeText, setChallengeText] = useState("");
  const [showChallenge, setShowChallenge] = useState(false);
  const [submitted, setSubmitted] = useState<"approved" | "challenged" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: fetchError } = useQuery({
    queryKey: ["timesheet-approval", token],
    queryFn: async () => {
      const res = await fetch(`/api/timesheet-approval/${token}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to load" }));
        throw new Error(err.error || "Failed to load");
      }
      return res.json() as Promise<{ week: TimesheetWeek; entries: TimesheetEntry[] }>;
    },
    retry: false,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/timesheet-approval/${token}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: approverName, email: approverEmail }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Approval failed");
      }
      return res.json();
    },
    onSuccess: () => setSubmitted("approved"),
    onError: (e: any) => setError(e.message),
  });

  const challengeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/timesheet-approval/${token}/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: challengeText }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Challenge failed");
      }
      return res.json();
    },
    onSuccess: () => setSubmitted("challenged"),
    onError: (e: any) => setError(e.message),
  });

  if (isLoading) return <LoadingScreen />;
  if (fetchError) return <ErrorScreen message={(fetchError as Error).message} />;
  if (!data) return <ErrorScreen message="No data found" />;

  const { week, entries } = data;

  // Build worker × day grid
  const workerMap = new Map<number, { name: string; role: string; entries: TimesheetEntry[] }>();
  for (const e of entries) {
    if (!workerMap.has(e.worker_id)) {
      workerMap.set(e.worker_id, { name: e.worker_name, role: e.worker_role, entries: [] });
    }
    workerMap.get(e.worker_id)!.entries.push(e);
  }

  const weekStart = new Date(week.week_commencing);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split("T")[0];
  });

  if (submitted === "approved") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F4F5F7" }}>
        <div style={{ maxWidth: 480, background: "#fff", borderRadius: 12, padding: "40px 32px", textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
          <div style={{ width: 64, height: 64, background: "#dcfce7", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1A1D23", marginBottom: 8 }}>Timesheet Approved</h2>
          <p style={{ color: "#6b7280", fontSize: 14, lineHeight: 1.6 }}>
            Thank you, <strong>{approverName}</strong>. Your approval has been recorded and the project team has been notified.
          </p>
          <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 16 }}>
            Week commencing {fmtDate(week.week_commencing)} · {week.project_name}
          </p>
        </div>
      </div>
    );
  }

  if (submitted === "challenged") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F4F5F7" }}>
        <div style={{ maxWidth: 480, background: "#fff", borderRadius: 12, padding: "40px 32px", textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
          <div style={{ width: 64, height: 64, background: "#fef3c7", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1A1D23", marginBottom: 8 }}>Challenge Submitted</h2>
          <p style={{ color: "#6b7280", fontSize: 14, lineHeight: 1.6 }}>
            Your challenge has been sent to the project team. They will review your feedback and be in touch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#F4F5F7" }}>
      {/* Header */}
      <div style={{ background: "#1A1D23", padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <img src="/logo-gold.png" alt="Powerforce Global" style={{ height: 32 }} />
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Timesheet Approval
        </span>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
        {/* Project header */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", marginBottom: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1A1D23", margin: 0 }}>{week.project_name}</h1>
              <p style={{ color: "#6b7280", fontSize: 14, margin: "4px 0 0" }}>{week.customer}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: "#6b7280" }}>Week commencing</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1A1D23" }}>{fmtDate(week.week_commencing)}</div>
            </div>
          </div>
          <p style={{ color: "#6b7280", fontSize: 13, marginTop: 16, lineHeight: 1.6 }}>
            Please review the timesheet below for all personnel. Once you are satisfied, enter your name and email address and click <strong>Approve Timesheet</strong>. If you have any concerns, use the <strong>Raise a Challenge</strong> button instead.
          </p>
        </div>

        {/* Timesheet grid */}
        <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 24 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#1A1D23" }}>
                  <th style={{ textAlign: "left", padding: "10px 16px", color: "#fff", fontWeight: 700, fontSize: 11, minWidth: 160 }}>WORKER / ROLE</th>
                  {weekDates.map((date, i) => {
                    const d = new Date(date);
                    return (
                      <th key={date} style={{ textAlign: "center", padding: "10px 8px", color: "#F5BD00", fontWeight: 700, fontSize: 11, minWidth: 90 }}>
                        <div>{DAY_LABELS[i]}</div>
                        <div style={{ color: "rgba(255,255,255,0.6)", fontWeight: 400, fontSize: 10 }}>
                          {d.getUTCDate()}/{d.getUTCMonth() + 1}
                        </div>
                      </th>
                    );
                  })}
                  <th style={{ textAlign: "center", padding: "10px 8px", color: "#F5BD00", fontWeight: 700, fontSize: 11, minWidth: 70 }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(workerMap.values()).map((worker, wi) => {
                  const totalHours = worker.entries.reduce((sum, e) => sum + (parseFloat(e.total_hours || "0") || 0), 0);
                  return (
                    <tr key={wi} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "12px 16px", background: wi % 2 === 0 ? "#fafafa" : "#fff" }}>
                        <div style={{ fontWeight: 600, color: "#1A1D23", fontSize: 13 }}>{worker.name}</div>
                        <div style={{ color: "#6b7280", fontSize: 11 }}>{worker.role}</div>
                      </td>
                      {weekDates.map((date) => {
                        const entry = worker.entries.find(e => e.entry_date?.toString().substring(0, 10) === date);
                        if (!entry) {
                          return <td key={date} style={{ textAlign: "center", padding: "8px 4px", background: wi % 2 === 0 ? "#fafafa" : "#fff" }}>
                            <span style={{ color: "#d1d5db", fontSize: 11 }}>—</span>
                          </td>;
                        }
                        const bg = dayTypeBg(entry.day_type);
                        const textColor = dayTypeText(entry.day_type);
                        return (
                          <td key={date} style={{ textAlign: "center", padding: "6px 4px", background: bg }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: textColor }}>{dayTypeLabel(entry.day_type)}</div>
                            {entry.time_in && entry.time_out && (
                              <div style={{ fontSize: 10, color: "#374151" }}>
                                {entry.time_in.substring(0, 5)}–{entry.time_out.substring(0, 5)}
                              </div>
                            )}
                            {entry.total_hours && (
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#1A1D23" }}>
                                {parseFloat(entry.total_hours).toFixed(1)}h
                              </div>
                            )}
                            {entry.supervisor_note && (
                              <div style={{ fontSize: 9, color: "#9ca3af", maxWidth: 80, margin: "0 auto" }} title={entry.supervisor_note}>
                                📝
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td style={{ textAlign: "center", padding: "8px", fontWeight: 700, color: "#1A1D23", fontSize: 14, background: wi % 2 === 0 ? "#fafafa" : "#fff" }}>
                        {totalHours.toFixed(1)}h
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "#1A1D23" }}>
                  <td style={{ padding: "10px 16px", color: "#F5BD00", fontWeight: 700, fontSize: 12 }}>TOTALS</td>
                  {weekDates.map((date) => {
                    const dayTotal = entries
                      .filter(e => e.entry_date?.toString().substring(0, 10) === date)
                      .reduce((sum, e) => sum + (parseFloat(e.total_hours || "0") || 0), 0);
                    return (
                      <td key={date} style={{ textAlign: "center", padding: "10px 4px", color: "#fff", fontWeight: 600, fontSize: 11 }}>
                        {dayTotal > 0 ? `${dayTotal.toFixed(1)}h` : "—"}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: "center", padding: "10px", color: "#F5BD00", fontWeight: 700, fontSize: 14 }}>
                    {entries.reduce((sum, e) => sum + (parseFloat(e.total_hours || "0") || 0), 0).toFixed(1)}h
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Approval form */}
        {!showChallenge ? (
          <div style={{ background: "#fff", borderRadius: 12, padding: "28px 28px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1A1D23", marginBottom: 16 }}>Approve Timesheet</h3>
            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Your Full Name *</label>
                <input
                  type="text"
                  value={approverName}
                  onChange={e => setApproverName(e.target.value)}
                  placeholder="e.g. John Smith"
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Your Email Address *</label>
                <input
                  type="email"
                  value={approverEmail}
                  onChange={e => setApproverEmail(e.target.value)}
                  placeholder="e.g. john@company.com"
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 20, lineHeight: 1.5 }}>
              By clicking <strong>Approve Timesheet</strong>, you confirm that the hours and attendance recorded above are correct. Your name, email address, IP address, and timestamp will be recorded.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  setError(null);
                  if (!approverName.trim() || !approverEmail.trim()) {
                    setError("Please enter your name and email address");
                    return;
                  }
                  approveMutation.mutate();
                }}
                disabled={approveMutation.isPending}
                style={{
                  background: "#F5BD00", color: "#1A1D23", fontWeight: 700, fontSize: 14,
                  padding: "12px 28px", borderRadius: 8, border: "none", cursor: "pointer",
                  opacity: approveMutation.isPending ? 0.7 : 1,
                }}
              >
                {approveMutation.isPending ? "Submitting…" : "✓ Approve Timesheet"}
              </button>
              <button
                onClick={() => setShowChallenge(true)}
                style={{
                  background: "transparent", color: "#6b7280", fontWeight: 600, fontSize: 14,
                  padding: "12px 24px", borderRadius: 8, border: "1px solid #d1d5db", cursor: "pointer",
                }}
              >
                Raise a Challenge
              </button>
            </div>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, padding: "28px 28px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1A1D23", marginBottom: 8 }}>Raise a Challenge</h3>
            <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
              Describe the discrepancy or concern below. The project team will be notified immediately and will follow up with you.
            </p>
            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>
                {error}
              </div>
            )}
            <textarea
              value={challengeText}
              onChange={e => setChallengeText(e.target.value)}
              rows={5}
              placeholder="Describe the issue…"
              style={{ width: "100%", padding: "12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, resize: "vertical", boxSizing: "border-box", outline: "none" }}
            />
            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  setError(null);
                  if (!challengeText.trim()) {
                    setError("Please describe the challenge");
                    return;
                  }
                  challengeMutation.mutate();
                }}
                disabled={challengeMutation.isPending}
                style={{
                  background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 14,
                  padding: "12px 28px", borderRadius: 8, border: "none", cursor: "pointer",
                  opacity: challengeMutation.isPending ? 0.7 : 1,
                }}
              >
                {challengeMutation.isPending ? "Submitting…" : "Submit Challenge"}
              </button>
              <button
                onClick={() => { setShowChallenge(false); setError(null); }}
                style={{
                  background: "transparent", color: "#6b7280", fontWeight: 600, fontSize: 14,
                  padding: "12px 24px", borderRadius: 8, border: "1px solid #d1d5db", cursor: "pointer",
                }}
              >
                Back to Approval
              </button>
            </div>
          </div>
        )}

        {/* Hash info */}
        <p style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", marginTop: 24 }}>
          Integrity hash: {week.approval_hash?.substring(0, 12) || "pending"} · &copy; {new Date().getFullYear()} Powerforce Global
        </p>
      </div>
    </div>
  );
}
