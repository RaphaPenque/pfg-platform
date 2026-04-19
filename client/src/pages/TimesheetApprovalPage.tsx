/**
 * Customer-facing Timesheet Approval Page
 * Public route: /#/timesheet-approval/:token
 * Design: matches approved timesheet PDF aesthetic (white sheet, 3px navy header border, meta grid, same table style)
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";

interface TimesheetEntry {
  id: number; worker_id: number; worker_name: string; worker_role: string;
  entry_date: string; shift: string; time_in: string | null; time_out: string | null;
  unpaid_break_minutes: number; day_type: string; total_hours: string | null;
  supervisor_note: string | null; is_override: boolean;
}
interface TimesheetWeek {
  id: number; project_id: number; project_name: string; project_code: string;
  customer: string; week_commencing: string; status: string; approval_hash: string;
  approval_name?: string; approval_email?: string;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}
function fmtDateShort(iso: string) {
  try { const d = new Date(iso); return `${d.getUTCDate().toString().padStart(2,"0")}/${(d.getUTCMonth()+1).toString().padStart(2,"0")}`; }
  catch { return iso; }
}
function dayTypeClass(dt: string): string {
  const m: Record<string,string> = { rest_day:"rest", absent_sick:"sick", mob:"mob", partial_mob:"mob", demob:"demob", partial_demob:"demob", absent_unauthorised:"sick" };
  return m[dt] || "";
}
function dayTypeLabel(dt: string): string {
  const m: Record<string,string> = { rest_day:"Rest Day", absent_sick:"Absent — Sick", mob:"MOB", partial_mob:"MOB ½", demob:"DEMOB", partial_demob:"DEMOB ½", absent_unauthorised:"Absent" };
  return m[dt] || "";
}

function LoadingScreen() {
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#F8F9FA" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:36, height:36, border:"3px solid #D4A017", borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 14px" }} />
        <p style={{ color:"#6B7280", fontSize:13 }}>Loading timesheet…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#F8F9FA" }}>
      <div style={{ maxWidth:460, background:"#fff", borderRadius:10, padding:"40px 32px", textAlign:"center", boxShadow:"0 4px 20px rgba(0,0,0,0.08)", border:"1px solid #E5E7EB" }}>
        <div style={{ fontSize:40, marginBottom:14 }}>⚠️</div>
        <h2 style={{ fontSize:19, fontWeight:700, color:"#1a2744", marginBottom:8 }}>Unable to Load Timesheet</h2>
        <p style={{ color:"#6B7280", fontSize:13 }}>{message}</p>
      </div>
    </div>
  );
}

// Shared table header columns
function TableHead({ weekDates }: { weekDates: Date[] }) {
  return (
    <thead>
      <tr>
        <th style={{ textAlign:"left", padding:"8px 6px 8px 14px", background:"#1a2744", color:"white", fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.03em", minWidth:170, borderRight:"1px solid rgba(255,255,255,0.08)" }}>Worker / Role</th>
        {weekDates.map((d, i) => (
          <th key={i} style={{ textAlign:"center", padding:"8px 6px", background:"#1a2744", color:"#D4A017", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.03em", minWidth:70, borderRight:"1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ display:"block" }}>{DAY_LABELS[i]}</span>
            <span style={{ display:"block", fontSize:9, fontWeight:400, color:"rgba(255,255,255,0.5)", marginTop:1 }}>{fmtDateShort(d.toISOString())}</span>
          </th>
        ))}
        <th style={{ textAlign:"right", padding:"8px 10px", background:"#1a2744", color:"#D4A017", fontSize:10, fontWeight:800, minWidth:58 }}>Total</th>
      </tr>
    </thead>
  );
}

function WorkerRow({ worker, entries, weekDates, idx }: { worker: { name: string; role: string; shift: string }; entries: TimesheetEntry[]; weekDates: Date[]; idx: number }) {
  const bg = idx % 2 === 0 ? "#FAFBFC" : "white";
  let total = 0;
  return (
    <tr>
      <td style={{ padding:"7px 6px 7px 14px", border:"1px solid #E5E7EB", background:bg }}>
        <div style={{ fontWeight:600, color:"#1a2744", fontSize:11, whiteSpace:"nowrap" }}>{worker.name}</div>
        <div style={{ fontSize:10, color:"#6B7C93" }}>{worker.role}</div>
        <div style={{ fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.04em", color: worker.shift === "night" ? "#3730A3" : "#B45309" }}>{worker.shift}</div>
      </td>
      {weekDates.map((d) => {
        const dateStr = d.toISOString().split("T")[0];
        const entry = entries.find(e => String(e.entry_date).substring(0,10) === dateStr);
        if (!entry) return <td key={dateStr} style={{ textAlign:"center", padding:"7px 6px", border:"1px solid #E5E7EB", background:bg, fontSize:10, color:"#D1D5DB" }}>—</td>;
        const cls = dayTypeClass(entry.day_type);
        const label = dayTypeLabel(entry.day_type);
        const hrs = parseFloat(entry.total_hours || "0") || 0;
        total += hrs;

        const cellStyles: Record<string, React.CSSProperties> = {
          rest:  { background:"#F3F4F6", color:"#9CA3AF", fontWeight:600, textTransform:"uppercase", fontSize:10, letterSpacing:"0.06em" },
          sick:  { background:"#FEE2E2", color:"#B91C1C", fontWeight:700, textTransform:"uppercase", fontSize:10, letterSpacing:"0.06em" },
          mob:   { background:"#E0F2FE", color:"#075985", fontWeight:700, textTransform:"uppercase", fontSize:10, letterSpacing:"0.06em" },
          demob: { background:"#FEF3C7", color:"#92400E", fontWeight:700, textTransform:"uppercase", fontSize:10, letterSpacing:"0.06em" },
        };
        const overrideStyle: React.CSSProperties = entry.is_override ? { background:"#FFFBF0" } : { background:bg };
        if (cls) return <td key={dateStr} style={{ textAlign:"center", padding:"7px 6px", border:"1px solid #E5E7EB", ...cellStyles[cls] }}>{label}</td>;
        const tin = entry.time_in?.substring(0,5) || "";
        const tout = entry.time_out?.substring(0,5) || "";
        return (
          <td key={dateStr} style={{ textAlign:"center", padding:"7px 6px", border:"1px solid #E5E7EB", ...overrideStyle, lineHeight:1.35 }}>
            <span style={{ fontWeight:600, color: entry.is_override ? "#92650A" : "#1a2744", display:"block", fontSize:10 }}>{tin}/{tout}</span>
            <span style={{ color:"#6B7C93", fontSize:9.5 }}>{hrs.toFixed(1)}h</span>
          </td>
        );
      })}
      <td style={{ textAlign:"right", padding:"7px 10px", border:"1px solid #E5E7EB", fontWeight:700, color:"#1a2744", fontSize:11.5, background:bg }}>{total.toFixed(1)}h</td>
    </tr>
  );
}

export default function TimesheetApprovalPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [challengeText, setChallengeText] = useState("");
  const [showChallenge, setShowChallenge] = useState(false);
  const [submitted, setSubmitted] = useState<"approved" | "challenged" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: fetchError } = useQuery({
    queryKey: ["timesheet-approval", token],
    queryFn: async () => {
      const res = await fetch(`/api/timesheet-approval/${token}`);
      if (!res.ok) { const e = await res.json().catch(() => ({ error: "Failed to load" })); throw new Error(e.error || "Failed"); }
      return res.json() as Promise<{ week: TimesheetWeek; entries: TimesheetEntry[] }>;
    },
    retry: false,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/timesheet-approval/${token}/approve`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({}) });
      if (!res.ok) { const e = await res.json().catch(() => ({ error:"Failed" })); throw new Error(e.error || "Approval failed"); }
      return res.json();
    },
    onSuccess: () => setSubmitted("approved"),
    onError: (e: any) => setError(e.message),
  });

  const challengeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/timesheet-approval/${token}/challenge`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ message: challengeText }) });
      if (!res.ok) { const e = await res.json().catch(() => ({ error:"Failed" })); throw new Error(e.error || "Challenge failed"); }
      return res.json();
    },
    onSuccess: () => setSubmitted("challenged"),
    onError: (e: any) => setError(e.message),
  });

  if (isLoading) return <LoadingScreen />;
  if (fetchError) return <ErrorScreen message={(fetchError as Error).message} />;
  if (!data) return <ErrorScreen message="No data found" />;

  const { week, entries } = data;

  const workerMap = new Map<number, { name: string; role: string; shift: string; entries: TimesheetEntry[] }>();
  for (const e of entries) {
    if (!workerMap.has(e.worker_id)) workerMap.set(e.worker_id, { name: e.worker_name, role: e.worker_role, shift: e.shift, entries: [] });
    workerMap.get(e.worker_id)!.entries.push(e);
  }

  const weekStart = new Date(week.week_commencing);
  const weekDates = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + i); return d; });

  const dayWorkers = Array.from(workerMap.values()).filter(w => w.shift === "day");
  const nightWorkers = Array.from(workerMap.values()).filter(w => w.shift === "night");

  // ── States ────────────────────────────────────────────────────────────────

  if (submitted === "approved") {
    return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#F8F9FA", padding:"40px 16px" }}>
        <div style={{ maxWidth:500, background:"#fff", borderRadius:10, padding:"44px 40px", textAlign:"center", boxShadow:"0 10px 15px -3px rgba(17,24,39,0.1)", border:"1px solid #E5E7EB" }}>
          <div style={{ width:64, height:64, background:"#DCFCE7", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h2 style={{ fontSize:21, fontWeight:800, color:"#1a2744", marginBottom:8 }}>Timesheet Approved</h2>
          <p style={{ color:"#6B7280", fontSize:13, lineHeight:1.65, marginBottom:6 }}>
            Thank you. Your approval has been cryptographically recorded and the project team has been notified.
          </p>
          <p style={{ fontSize:11, color:"#9CA3AF", marginBottom:22 }}>{week.project_name} · w/c {fmtDate(week.week_commencing)}</p>
          <div style={{ height:1, background:"#E5E7EB", marginBottom:20 }} />
          <div style={{ display:"flex", alignItems:"center", gap:8, background:"#DCFCE7", border:"1px solid #BBF7D0", borderRadius:6, padding:"11px 14px", justifyContent:"center", marginBottom:14, fontSize:12, fontWeight:600, color:"#166534" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Your signed copy is ready to download
          </div>
          <a href={`/api/timesheet-weeks/${week.id}/pdf`} style={{ display:"inline-flex", alignItems:"center", gap:8, background:"#1a2744", color:"white", padding:"12px 26px", borderRadius:8, fontWeight:700, fontSize:13, textDecoration:"none" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download Signed Timesheet PDF
          </a>
          <p style={{ fontSize:11, color:"#9CA3AF", marginTop:14 }}>Also accessible on the Customer Portal under Timesheets.</p>
        </div>
      </div>
    );
  }

  if (submitted === "challenged") {
    return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#F8F9FA", padding:"40px 16px" }}>
        <div style={{ maxWidth:500, background:"#fff", borderRadius:10, padding:"44px 40px", textAlign:"center", boxShadow:"0 10px 15px -3px rgba(17,24,39,0.1)", border:"1px solid #E5E7EB" }}>
          <div style={{ width:64, height:64, background:"#FEF3C7", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <h2 style={{ fontSize:21, fontWeight:800, color:"#1a2744", marginBottom:8 }}>Challenge Submitted</h2>
          <p style={{ color:"#6B7280", fontSize:13, lineHeight:1.65 }}>Your challenge has been sent to the project manager. They will review your feedback, make any necessary corrections, and re-submit the timesheet for your approval.</p>
          <p style={{ fontSize:11, color:"#9CA3AF", marginTop:12 }}>You will receive a new approval link by email once the timesheet has been updated.</p>
        </div>
      </div>
    );
  }

  // ── Main view ─────────────────────────────────────────────────────────────
  const sectionLabelStyle: React.CSSProperties = { fontSize:10, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#6B7C93", marginBottom:10, marginTop:22, display:"flex", alignItems:"center", gap:10 };
  const shiftDotDay: React.CSSProperties = { width:7, height:7, borderRadius:"50%", background:"#B45309", flexShrink:0, display:"inline-block" };
  const shiftDotNight: React.CSSProperties = { width:7, height:7, borderRadius:"50%", background:"#3730A3", flexShrink:0, display:"inline-block" };

  return (
    <div style={{ background:"#F8F9FA", minHeight:"100vh", padding:"28px 20px 60px", fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif" }}>
      <style>{`.sec-line::after{content:"";flex:1;height:1px;background:#E5E7EB;} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ background:"white", border:"1px solid #E5E7EB", borderRadius:8, maxWidth:1100, margin:"0 auto", overflow:"hidden", boxShadow:"0 10px 15px -3px rgba(17,24,39,0.10)" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"36px 50px 18px", borderBottom:"3px solid #1a2744" }}>
          <img src="/logo-gold.png" alt="Powerforce Global" style={{ height:50, width:"auto", display:"block" }} />
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:16, fontWeight:700, color:"#1a2744", letterSpacing:"0.04em", textTransform:"uppercase" }}>Weekly Timesheet</div>
            <div style={{ fontSize:10, color:"#6B7C93", marginTop:4 }}>Approval required · w/c {week.week_commencing?.toString().substring(0,10)}</div>
          </div>
        </div>

        {/* Meta grid */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", borderBottom:"1px solid #E5E7EB" }}>
          {[
            { label:"Project", value:week.project_name },
            { label:"Customer", value:week.customer },
            { label:"Week Commencing", value:fmtDate(week.week_commencing) },
            { label:"Contract Type", value:"T&M · Time & Material" },
          ].map((m, i) => (
            <div key={i} style={{ padding:"10px 14px", borderRight: i < 3 ? "1px solid #E5E7EB" : "none", background:"#FAFBFC" }}>
              <div style={{ fontSize:9, fontWeight:700, color:"#6B7C93", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:3 }}>{m.label}</div>
              <div style={{ fontSize:12, fontWeight:600, color:"#1a2744" }}>{m.value}</div>
            </div>
          ))}
        </div>

        <div style={{ padding:"24px 50px 36px", fontSize:11.5, color:"#1F2937" }}>

          {/* Day shift */}
          {dayWorkers.length > 0 && (
            <>
              <div className="sec-line" style={{ ...sectionLabelStyle }}><span style={shiftDotDay} /> Day Shift</div>
              <div style={{ border:"1px solid #E5E7EB", borderRadius:4, overflow:"hidden", marginBottom:18 }}>
                <div style={{ background:"#EEF1F7", borderBottom:"1px solid #E5E7EB", padding:"6px 14px", fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#1a2744" }}>
                  Day Shift
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontVariantNumeric:"tabular-nums" }}>
                    <TableHead weekDates={weekDates} />
                    <tbody>
                      {dayWorkers.map((w, i) => <WorkerRow key={i} worker={w} entries={w.entries} weekDates={weekDates} idx={i} />)}
                      <tr style={{ background:"#EEF1F7" }}>
                        <td colSpan={8} style={{ padding:"8px 14px", fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:700, color:"#1a2744", borderTop:"2px solid #1a2744" }}>Day Shift Total</td>
                        <td style={{ textAlign:"right", padding:"8px 10px", fontWeight:800, color:"#1a2744", fontSize:13, borderTop:"2px solid #1a2744" }}>
                          {dayWorkers.reduce((s,w) => s + w.entries.reduce((ss,e) => ss + (parseFloat(e.total_hours||"0")||0), 0), 0).toFixed(1)}h
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Night shift */}
          {nightWorkers.length > 0 && (
            <>
              <div className="sec-line" style={{ ...sectionLabelStyle }}><span style={shiftDotNight} /> Night Shift</div>
              <div style={{ border:"1px solid #E5E7EB", borderRadius:4, overflow:"hidden", marginBottom:18 }}>
                <div style={{ background:"#EEF1F7", borderBottom:"1px solid #E5E7EB", padding:"6px 14px", fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#1a2744" }}>
                  Night Shift
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontVariantNumeric:"tabular-nums" }}>
                    <TableHead weekDates={weekDates} />
                    <tbody>
                      {nightWorkers.map((w, i) => <WorkerRow key={i} worker={w} entries={w.entries} weekDates={weekDates} idx={i} />)}
                      <tr style={{ background:"#EEF1F7" }}>
                        <td colSpan={8} style={{ padding:"8px 14px", fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:700, color:"#1a2744", borderTop:"2px solid #1a2744" }}>Night Shift Total</td>
                        <td style={{ textAlign:"right", padding:"8px 10px", fontWeight:800, color:"#1a2744", fontSize:13, borderTop:"2px solid #1a2744" }}>
                          {nightWorkers.reduce((s,w) => s + w.entries.reduce((ss,e) => ss + (parseFloat(e.total_hours||"0")||0), 0), 0).toFixed(1)}h
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Approval box */}
          <div style={{ background:"#FAFBFC", border:"1px solid #E5E7EB", borderRadius:4, padding:"20px 24px" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#1a2744", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Your Approval</div>
            <div style={{ fontSize:11, color:"#6B7280", lineHeight:1.65, marginBottom:16, paddingBottom:16, borderBottom:"1px solid #E5E7EB" }}>
              Please review the timesheet above. If the hours and attendance are correct, click <strong style={{ color:"#1a2744" }}>Approve Timesheet</strong>.
              If you have any concerns, click <strong style={{ color:"#1a2744" }}>Raise a Challenge</strong> — the project manager will be notified and will re-submit once corrected.<br /><br />
              Your approval will be recorded with your IP address and timestamp as confirmation of this sign-off.
            </div>

            {error && <div style={{ background:"#FEE2E2", border:"1px solid #FCA5A5", borderRadius:6, padding:"10px 14px", color:"#B91C1C", fontSize:12, marginBottom:14 }}>{error}</div>}

            {!showChallenge ? (
              <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                <button onClick={() => { setError(null); approveMutation.mutate(); }} disabled={approveMutation.isPending}
                  style={{ display:"inline-flex", alignItems:"center", gap:8, background:"#D4A017", color:"#1a2744", padding:"12px 26px", borderRadius:8, border:"none", fontWeight:700, fontSize:13, cursor:"pointer", opacity: approveMutation.isPending ? 0.7 : 1 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {approveMutation.isPending ? "Submitting…" : "Approve Timesheet"}
                </button>
                <button onClick={() => setShowChallenge(true)}
                  style={{ background:"transparent", color:"#6B7280", padding:"12px 22px", borderRadius:8, border:"1px solid #D1D5DB", fontWeight:600, fontSize:13, cursor:"pointer" }}>
                  Raise a Challenge
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize:13, color:"#6B7280", lineHeight:1.6, marginBottom:12 }}>
                  Describe the discrepancy below. The project manager will be notified immediately and will re-submit once corrected.
                </div>
                <textarea value={challengeText} onChange={e => setChallengeText(e.target.value)} rows={4}
                  placeholder="e.g. The hours for Mario Milcic on Thursday 16 Apr should be recorded as a public holiday, not sick leave..."
                  style={{ width:"100%", padding:"10px 12px", border:"1px solid #D1D5DB", borderRadius:8, fontFamily:"inherit", fontSize:13, resize:"vertical", outline:"none", marginBottom:14 }} />
                <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                  <button onClick={() => { setError(null); if (!challengeText.trim()) { setError("Please describe the challenge."); return; } challengeMutation.mutate(); }}
                    disabled={challengeMutation.isPending}
                    style={{ background:"#dc2626", color:"white", padding:"12px 26px", borderRadius:8, border:"none", fontWeight:700, fontSize:13, cursor:"pointer", opacity: challengeMutation.isPending ? 0.7 : 1 }}>
                    {challengeMutation.isPending ? "Submitting…" : "Submit Challenge"}
                  </button>
                  <button onClick={() => { setShowChallenge(false); setError(null); }}
                    style={{ background:"transparent", color:"#6B7280", padding:"12px 22px", borderRadius:8, border:"1px solid #D1D5DB", fontWeight:600, fontSize:13, cursor:"pointer" }}>
                    Back to Approval
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Security footer */}
          <div style={{ textAlign:"center", fontSize:10, color:"#9CA3AF", marginTop:18, lineHeight:1.6 }}>
            This link is personal to you and expires in 48 hours &nbsp;·&nbsp;
            Integrity hash: <span style={{ fontFamily:"monospace", background:"white", border:"1px solid #E5E7EB", borderRadius:3, padding:"1px 6px" }}>{week.approval_hash?.substring(0,12) || "pending"}</span> &nbsp;·&nbsp;
            © {new Date().getFullYear()} Powerforce Global · Confidential
          </div>

        </div>
      </div>
    </div>
  );
}
