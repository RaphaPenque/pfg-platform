import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  type DashboardProject,
  type DashboardWorker,
  type DashboardAssignment,
} from "@/hooks/use-dashboard-data";
import {
  FileText, Users, Shield, BarChart3,
  ChevronLeft, ChevronRight, Plus, Trash2, Upload,
  Send, Download, Search, AlertTriangle, CheckCircle,
  Clock, XCircle, Loader2, Eye, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";

// ─── Props ──────────────────────────────────────────────────────────

interface DailyReportHubProps {
  project: DashboardProject;
  workers: DashboardWorker[];
  assignments: DashboardAssignment[];
  user: any;
}

// ─── Helpers ────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// ─── Sub-tab nav items ───────────────────────────────────────────────

const SUB_TABS = [
  { key: "pm", label: "PM Report", icon: <FileText className="w-4 h-4" /> },
  { key: "supervisor", label: "Supervisor Reports", icon: <Users className="w-4 h-4" /> },
  { key: "qhse", label: "QHSE", icon: <Shield className="w-4 h-4" /> },
  { key: "kpis", label: "Safety KPIs", icon: <BarChart3 className="w-4 h-4" /> },
];

// ─── Skeleton loader ─────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded ${className || ""}`}
      style={{ background: "hsl(var(--muted))" }}
    />
  );
}

// ─── Section header ──────────────────────────────────────────────────

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-[14px] font-semibold" style={{ color: "var(--pfg-navy)" }}>
        {title}
      </h3>
      {action}
    </div>
  );
}

// ─── Table wrapper ────────────────────────────────────────────────────

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "hsl(var(--border))" }}>
      <table className="w-full text-[12px] min-w-max">{children}</table>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${className || ""}`}
      style={{ background: "var(--pfg-navy)", color: "#fff" }}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 ${className || ""}`} style={{ borderTop: "1px solid hsl(var(--border))" }}>
      {children}
    </td>
  );
}

// ─── Input helpers ────────────────────────────────────────────────────

function TdInput({
  value,
  onChange,
  type = "text",
  disabled,
  placeholder,
  className,
}: {
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className={`w-full px-2 py-1 rounded border text-[12px] bg-transparent ${className || ""}`}
      style={{ borderColor: "hsl(var(--border))", outline: "none", minWidth: "80px" }}
    />
  );
}

function TdSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="px-2 py-1 rounded border text-[12px] bg-transparent"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-8" style={{ color: "var(--pfg-steel)" }}>
      <p className="text-[13px]">{message}</p>
    </div>
  );
}

// ─── STATUS BADGE util ────────────────────────────────────────────────

function StatusBadge({
  label,
  color,
}: {
  label: string;
  color: "green" | "amber" | "red" | "blue" | "navy" | "grey";
}) {
  const map: Record<string, { bg: string; text: string }> = {
    green: { bg: "var(--green-bg)", text: "var(--green)" },
    amber: { bg: "var(--amber-bg)", text: "var(--amber)" },
    red: { bg: "var(--red-bg)", text: "var(--red)" },
    blue: { bg: "#dbeafe", text: "#1d4ed8" },
    navy: { bg: "var(--pfg-navy)", text: "#fff" },
    grey: { bg: "hsl(var(--muted))", text: "hsl(var(--muted-foreground))" },
  };
  const { bg, text } = map[color] || map.grey;
  return (
    <span
      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: bg, color: text }}
    >
      {label}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
// SUB-TAB 1: PM Report
// ════════════════════════════════════════════════════════════════════

interface CompletedTask {
  description: string;
  pctComplete: number;
  notes: string;
}

interface DelayEntry {
  description: string;
  duration: number;
  durationUnit: "hrs" | "days";
  criticalPath: "Yes" | "No";
  responsibility: "PFG Fault" | "External";
  agreedWithCustomer: "Yes" | "No" | "Pending";
  approvalStatus?: "Sent" | "Approved" | "Rejected";
}

interface ToolingItem {
  description: string;
  taskFor: string;
  purchased: "Yes" | "No" | "Ordered by Customer";
  masterList: boolean;
  billable: boolean;
}

interface DailyReport {
  id?: number;
  projectId: number;
  date: string;
  completedTasks: CompletedTask[];
  delaysLog: DelayEntry[];
  toolingItems: ToolingItem[];
  personnelNotes: Record<string, string>;
  publishedToPortal: boolean;
  emailNotificationSent: boolean;
}

function PMReportTab({
  project,
  workers,
  assignments,
  user,
}: {
  project: DashboardProject;
  workers: DashboardWorker[];
  assignments: DashboardAssignment[];
  user: any;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);

  const isToday = selectedDate === todayStr();
  const isReadOnly = !isToday;
  const isObserver = user?.role === "observer";

  // Load report for this date
  const reportKey = `/api/projects/${project.id}/daily-reports?date=${selectedDate}`;
  const { data: reportData, isLoading: reportLoading } = useQuery<DailyReport | null>({
    queryKey: [reportKey],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/projects/${project.id}/daily-reports?date=${selectedDate}`);
        return res.json();
      } catch {
        return null;
      }
    },
  });

  // Load work packages
  const { data: workPackages = [], isLoading: wpLoading } = useQuery<any[]>({
    queryKey: [`/api/projects/${project.id}/work-packages`],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/projects/${project.id}/work-packages`);
        return res.json();
      } catch {
        return [];
      }
    },
  });

  // Load WP progress for today's report
  const { data: wpProgress = [] } = useQuery<any[]>({
    queryKey: [`/api/daily-reports/${reportData?.id}/wp-progress`, reportData?.id],
    queryFn: async () => {
      if (!reportData?.id) return [];
      try {
        const res = await apiRequest("GET", `/api/daily-reports/${reportData.id}/wp-progress`);
        return res.json();
      } catch {
        return [];
      }
    },
    enabled: !!reportData?.id,
  });

  // Load comments log
  const { data: commentsLog = [], isLoading: commentsLoading, refetch: refetchComments } = useQuery<any[]>({
    queryKey: [`/api/projects/${project.id}/comments-log`],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/projects/${project.id}/comments-log`);
        return res.json();
      } catch {
        return [];
      }
    },
  });

  // Local state for editable sections
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>(
    reportData?.completedTasks || []
  );
  const [delaysLog, setDelaysLog] = useState<DelayEntry[]>(reportData?.delaysLog || []);
  const [toolingItems, setToolingItems] = useState<ToolingItem[]>(reportData?.toolingItems || []);
  const [personnelNotes, setPersonnelNotes] = useState<Record<string, string>>(
    reportData?.personnelNotes || {}
  );
  const [newComment, setNewComment] = useState("");
  const [commentSearch, setCommentSearch] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [commentDate, setCommentDate] = useState<Date>(new Date());
  const [commentDateOpen, setCommentDateOpen] = useState(false);

  // Sync local state when report data loads
  useMemo(() => {
    if (reportData) {
      setCompletedTasks(reportData.completedTasks || []);
      setDelaysLog(reportData.delaysLog || []);
      setToolingItems(reportData.toolingItems || []);
      setPersonnelNotes(reportData.personnelNotes || {});
    }
  }, [reportData]);

  const projectAssignments = assignments.filter(
    (a) => a.projectId === project.id && ["active", "confirmed", "pending_confirmation"].includes(a.status || "")
  );

  // Save draft / publish
  const handleSave = useCallback(
    async (publish = false) => {
      setSaving(true);
      try {
        const payload = {
          projectId: project.id,
          date: selectedDate,
          completedTasks,
          delaysLog,
          toolingItems,
          personnelNotes,
          publishedToPortal: publish,
          emailNotificationSent: publish && sendEmail,
        };
        if (reportData?.id) {
          await apiRequest("PATCH", `/api/daily-reports/${reportData.id}`, payload);
        } else {
          await apiRequest("POST", `/api/daily-reports`, payload);
        }
        qc.invalidateQueries({ queryKey: [reportKey] });
        toast({
          title: publish ? "Report published to portal" : "Draft saved",
          description: publish && sendEmail ? "Email notification queued." : undefined,
        });
      } catch (e: any) {
        toast({ title: "Save failed", description: e.message, variant: "destructive" });
      }
      setSaving(false);
    },
    [project.id, selectedDate, completedTasks, delaysLog, toolingItems, personnelNotes, reportData, sendEmail, qc, reportKey, toast]
  );

  // Send delay approval
  const handleSendDelayApproval = useCallback(
    async (idx: number) => {
      if (!reportData?.id) {
        toast({ title: "Save the report first", variant: "destructive" });
        return;
      }
      try {
        await apiRequest("POST", `/api/daily-reports/${reportData.id}/send-delay-approval`, { delayIndex: idx });
        const updated = [...delaysLog];
        updated[idx] = { ...updated[idx], approvalStatus: "Sent" };
        setDelaysLog(updated);
        toast({ title: "Approval request sent" });
      } catch (e: any) {
        toast({ title: "Failed to send", description: e.message, variant: "destructive" });
      }
    },
    [reportData, delaysLog, toast]
  );

  // Add comment
  const handleAddComment = useCallback(async () => {
    if (!newComment.trim()) return;
    setAddingComment(true);
    try {
      const logDate = [
        commentDate.getFullYear(),
        String(commentDate.getMonth() + 1).padStart(2, '0'),
        String(commentDate.getDate()).padStart(2, '0'),
      ].join('-');
      await apiRequest("POST", `/api/projects/${project.id}/comments-log`, { entry: newComment, logDate });
      setNewComment("");
      refetchComments();
      toast({ title: "Comment added" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
    setAddingComment(false);
  }, [newComment, project.id, refetchComments, toast]);

  const filteredComments = useMemo(() => {
    if (!commentSearch) return commentsLog;
    const q = commentSearch.toLowerCase();
    return commentsLog.filter(
      (c: any) =>
        (c.entry || c.text || '').toLowerCase().includes(q) || c.user?.toLowerCase().includes(q)
    );
  }, [commentsLog, commentSearch]);

  // Sort comments by logDate descending (most recent first, back-dated entries slot in correctly)
  const sortedComments = useMemo(() => {
    return [...filteredComments].sort((a, b) => {
      const da = a.logDate || a.date || a.enteredAt || '';
      const db = b.logDate || b.date || b.enteredAt || '';
      return db.localeCompare(da);
    });
  }, [filteredComments]);

  if (reportLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  const isTM = project.contractType === "T&M";

  return (
    <div className="space-y-6">
      {/* Date navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSelectedDate(addDays(selectedDate, -1))}
          className="p-1.5 rounded-lg border hover:bg-black/5 transition-colors"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-[13px] font-semibold text-pfg-navy min-w-[160px] text-center">
          {fmtDate(selectedDate)}
          {isToday && (
            <span
              className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "var(--pfg-navy)", color: "#fff" }}
            >
              Today
            </span>
          )}
        </div>
        <button
          onClick={() => setSelectedDate(addDays(selectedDate, 1))}
          disabled={isToday}
          className="p-1.5 rounded-lg border hover:bg-black/5 transition-colors disabled:opacity-40"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {isReadOnly && (
          <span className="text-[11px] font-semibold px-2 py-1 rounded" style={{ background: "hsl(var(--muted))", color: "var(--pfg-steel)" }}>
            Read-only
          </span>
        )}
      </div>

      {/* 2.1 Outage Milestones — hidden for T&M */}
      {!isTM && (
        <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <SectionHeader title="2.1 — Outage Milestones" />
          {wpLoading ? (
            <Skeleton className="h-24" />
          ) : workPackages.length === 0 ? (
            <EmptyState message='No work packages configured for this project. Add them in the Role Planning tab.' />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>WP Name</Th>
                  <Th>Planned Start</Th>
                  <Th>Planned Finish</Th>
                  <Th>Actual Start</Th>
                  <Th>Actual Finish</Th>
                  <Th>Sign-off</Th>
                  <Th>Comments</Th>
                </tr>
              </thead>
              <tbody>
                {workPackages.map((wp: any) => {
                  const prog = wpProgress.find((p: any) => p.workPackageId === wp.id) || {};
                  return (
                    <tr key={wp.id}>
                      <Td><span className="font-medium">{wp.name}</span></Td>
                      <Td>{wp.plannedStart || "—"}</Td>
                      <Td>{wp.plannedFinish || "—"}</Td>
                      <Td>
                        <TdInput
                          type="date"
                          value={prog.actualStart || ""}
                          onChange={() => {}}
                          disabled={isReadOnly}
                        />
                      </Td>
                      <Td>
                        <TdInput
                          type="date"
                          value={prog.actualFinish || ""}
                          onChange={() => {}}
                          disabled={isReadOnly}
                        />
                      </Td>
                      <Td>
                        <TdSelect
                          value={prog.signoffStatus || "Pending"}
                          onChange={() => {}}
                          options={[
                            { value: "Pending", label: "Pending" },
                            { value: "Signed Off", label: "Signed Off" },
                          ]}
                          disabled={isReadOnly}
                        />
                      </Td>
                      <Td>
                        <TdInput
                          value={prog.comments || ""}
                          onChange={() => {}}
                          disabled={isReadOnly}
                          placeholder="Comments..."
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}

      {/* 2.2 Completed Tasks */}
      <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <SectionHeader
          title="2.2 — Completed Tasks"
          action={
            !isReadOnly ? (
              <button
                onClick={() =>
                  setCompletedTasks([...completedTasks, { description: "", pctComplete: 0, notes: "" }])
                }
                className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: "var(--pfg-navy)", color: "#fff" }}
              >
                <Plus className="w-3.5 h-3.5" /> Add Row
              </button>
            ) : null
          }
        />
        {completedTasks.length === 0 ? (
          <EmptyState message="No tasks logged yet." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th className="w-1/2">Task Description</Th>
                <Th>% Complete</Th>
                <Th>Notes</Th>
                {!isReadOnly && <Th></Th>}
              </tr>
            </thead>
            <tbody>
              {completedTasks.map((t, i) => (
                <tr key={i}>
                  <Td>
                    <TdInput
                      value={t.description}
                      onChange={(v) => {
                        const u = [...completedTasks];
                        u[i] = { ...u[i], description: v };
                        setCompletedTasks(u);
                      }}
                      disabled={isReadOnly}
                      placeholder="Task description"
                    />
                  </Td>
                  <Td>
                    <TdInput
                      type="number"
                      value={t.pctComplete}
                      onChange={(v) => {
                        const u = [...completedTasks];
                        u[i] = { ...u[i], pctComplete: Math.min(100, Math.max(0, Number(v))) };
                        setCompletedTasks(u);
                      }}
                      disabled={isReadOnly}
                      className="w-20"
                    />
                  </Td>
                  <Td>
                    <TdInput
                      value={t.notes}
                      onChange={(v) => {
                        const u = [...completedTasks];
                        u[i] = { ...u[i], notes: v };
                        setCompletedTasks(u);
                      }}
                      disabled={isReadOnly}
                      placeholder="Notes"
                    />
                  </Td>
                  {!isReadOnly && (
                    <Td>
                      <button
                        onClick={() => setCompletedTasks(completedTasks.filter((_, j) => j !== i))}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>

      {/* 2.3 Delays Log */}
      <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <SectionHeader
          title="2.3 — Delays Log"
          action={
            !isReadOnly ? (
              <button
                onClick={() =>
                  setDelaysLog([
                    ...delaysLog,
                    {
                      description: "",
                      duration: 0,
                      durationUnit: "hrs",
                      criticalPath: "No",
                      responsibility: "External",
                      agreedWithCustomer: "Pending",
                    },
                  ])
                }
                className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: "var(--pfg-navy)", color: "#fff" }}
              >
                <Plus className="w-3.5 h-3.5" /> Add Row
              </button>
            ) : null
          }
        />
        {delaysLog.length === 0 ? (
          <EmptyState message="No delays logged." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Description</Th>
                <Th>Duration</Th>
                <Th>Critical Path?</Th>
                <Th>Responsibility</Th>
                <Th>Agreed w/ Customer</Th>
                <Th>Status</Th>
                {!isReadOnly && <Th></Th>}
              </tr>
            </thead>
            <tbody>
              {delaysLog.map((d, i) => (
                <tr key={i}>
                  <Td>
                    <TdInput
                      value={d.description}
                      onChange={(v) => {
                        const u = [...delaysLog];
                        u[i] = { ...u[i], description: v };
                        setDelaysLog(u);
                      }}
                      disabled={isReadOnly}
                      placeholder="Delay description"
                    />
                  </Td>
                  <Td>
                    <div className="flex gap-1 items-center">
                      <TdInput
                        type="number"
                        value={d.duration}
                        onChange={(v) => {
                          const u = [...delaysLog];
                          u[i] = { ...u[i], duration: Number(v) };
                          setDelaysLog(u);
                        }}
                        disabled={isReadOnly}
                        className="w-16"
                      />
                      <TdSelect
                        value={d.durationUnit}
                        onChange={(v) => {
                          const u = [...delaysLog];
                          u[i] = { ...u[i], durationUnit: v as "hrs" | "days" };
                          setDelaysLog(u);
                        }}
                        options={[
                          { value: "hrs", label: "hrs" },
                          { value: "days", label: "days" },
                        ]}
                        disabled={isReadOnly}
                      />
                    </div>
                  </Td>
                  <Td>
                    <TdSelect
                      value={d.criticalPath}
                      onChange={(v) => {
                        const u = [...delaysLog];
                        u[i] = { ...u[i], criticalPath: v as "Yes" | "No" };
                        setDelaysLog(u);
                      }}
                      options={[
                        { value: "Yes", label: "Yes" },
                        { value: "No", label: "No" },
                      ]}
                      disabled={isReadOnly}
                    />
                  </Td>
                  <Td>
                    <TdSelect
                      value={d.responsibility}
                      onChange={(v) => {
                        const u = [...delaysLog];
                        u[i] = { ...u[i], responsibility: v as "PFG Fault" | "External" };
                        setDelaysLog(u);
                      }}
                      options={[
                        { value: "PFG Fault", label: "PFG Fault" },
                        { value: "External", label: "External" },
                      ]}
                      disabled={isReadOnly}
                    />
                  </Td>
                  <Td>
                    <TdSelect
                      value={d.agreedWithCustomer}
                      onChange={(v) => {
                        const u = [...delaysLog];
                        u[i] = { ...u[i], agreedWithCustomer: v as "Yes" | "No" | "Pending" };
                        setDelaysLog(u);
                      }}
                      options={[
                        { value: "Yes", label: "Yes" },
                        { value: "No", label: "No" },
                        { value: "Pending", label: "Pending" },
                      ]}
                      disabled={isReadOnly}
                    />
                  </Td>
                  <Td>
                    {d.agreedWithCustomer === "Pending" && !isReadOnly ? (
                      d.approvalStatus ? (
                        <StatusBadge
                          label={d.approvalStatus}
                          color={
                            d.approvalStatus === "Approved"
                              ? "green"
                              : d.approvalStatus === "Rejected"
                              ? "red"
                              : "amber"
                          }
                        />
                      ) : (
                        <button
                          onClick={() => handleSendDelayApproval(i)}
                          className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded"
                          style={{ background: "var(--amber-bg)", color: "var(--amber)" }}
                        >
                          <Send className="w-3 h-3" /> Send for Approval
                        </button>
                      )
                    ) : d.approvalStatus ? (
                      <StatusBadge
                        label={d.approvalStatus}
                        color={
                          d.approvalStatus === "Approved"
                            ? "green"
                            : d.approvalStatus === "Rejected"
                            ? "red"
                            : "amber"
                        }
                      />
                    ) : (
                      <span className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>—</span>
                    )}
                  </Td>
                  {!isReadOnly && (
                    <Td>
                      <button
                        onClick={() => setDelaysLog(delaysLog.filter((_, j) => j !== i))}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>

      {/* 2.4 Comments & Concerns Log */}
      <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <SectionHeader
          title="2.4 — Comments & Concerns Log"
          action={
            <div className="flex gap-2">
              <button
                onClick={() => toast({ title: "PDF export coming soon" })}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border"
                style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}
              >
                <Download className="w-3 h-3" /> PDF
              </button>
              <button
                onClick={() => toast({ title: "CSV export coming soon" })}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border"
                style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}
              >
                <Download className="w-3 h-3" /> CSV
              </button>
            </div>
          }
        />
        {/* Add entry */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="flex gap-2 items-start">
            {/* Date picker */}
            <div className="flex-shrink-0">
              <Popover open={commentDateOpen} onOpenChange={setCommentDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12px] font-medium hover:border-pfg-navy transition-colors"
                    style={{ borderColor: "hsl(var(--border))", minWidth: 120, background: "hsl(var(--card))" }}
                  >
                    <CalendarIcon className="w-3.5 h-3.5" style={{ color: "var(--pfg-steel)" }} />
                    <span>{commentDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start" style={{ zIndex: 99999 }}>
                  <Calendar
                    mode="single"
                    selected={commentDate}
                    onSelect={(d) => { if (d) { setCommentDate(d); setCommentDateOpen(false); } }}
                    initialFocus
                    defaultMonth={commentDate}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment or concern..."
              rows={2}
              className="flex-1 px-3 py-2 rounded-lg border text-[12px] resize-none"
              style={{ borderColor: "hsl(var(--border))" }}
            />
            <button
              onClick={handleAddComment}
              disabled={addingComment || !newComment.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold self-start disabled:opacity-50"
              style={{ background: "var(--pfg-navy)", color: "#fff" }}
            >
              {addingComment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Add Entry
            </button>
          </div>
        </div>
        {/* Search */}
        <div className="relative mb-3">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--pfg-steel)" }} />
          <input
            type="text"
            value={commentSearch}
            onChange={(e) => setCommentSearch(e.target.value)}
            placeholder="Search comments..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border text-[12px]"
            style={{ borderColor: "hsl(var(--border))" }}
          />
        </div>
        {/* Log */}
        {commentsLoading ? (
          <Skeleton className="h-20" />
        ) : sortedComments.length === 0 ? (
          <EmptyState message="No comments logged yet." />
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {sortedComments.map((c: any, i: number) => (
              <div key={i} className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "hsl(var(--muted))" }}>
                <div className="flex gap-2 mb-0.5">
                  <span className="font-semibold text-pfg-navy">{c.user || "Unknown"}</span>
                  <span style={{ color: "var(--pfg-steel)" }}>{fmtDate(c.logDate || c.date)}</span>
                </div>
                <p>{c.entry || c.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2.5 Outage Personnel */}
      <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <SectionHeader title="2.5 — Outage Personnel" />
        {projectAssignments.length === 0 ? (
          <EmptyState message="No personnel assigned to this project." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Start</Th>
                <Th>End</Th>
                <Th>Shift</Th>
                <Th>Daily Note</Th>
              </tr>
            </thead>
            <tbody>
              {projectAssignments.map((a) => {
                const worker = workers.find((w) => w.id === a.workerId);
                if (!worker) return null;
                return (
                  <tr key={a.id}>
                    <Td><span className="font-medium">{worker.name}</span></Td>
                    <Td>{a.role || worker.role}</Td>
                    <Td>{a.startDate || "—"}</Td>
                    <Td>{a.endDate || "—"}</Td>
                    <Td>
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          background: a.shift === "Night" ? "var(--pfg-navy)" : "var(--pfg-gold, #d4a017)",
                          color: "#fff",
                        }}
                      >
                        {a.shift || "Day"}
                      </span>
                    </Td>
                    <Td>
                      <TdInput
                        value={personnelNotes[String(a.workerId)] || ""}
                        onChange={(v) =>
                          setPersonnelNotes({ ...personnelNotes, [String(a.workerId)]: v })
                        }
                        disabled={isReadOnly}
                        placeholder="Today's note..."
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </div>

      {/* 2.6 Tooling & Consumables */}
      <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <SectionHeader
          title="2.6 — Tooling & Consumables"
          action={
            !isReadOnly ? (
              <button
                onClick={() =>
                  setToolingItems([
                    ...toolingItems,
                    { description: "", taskFor: "", purchased: "No", masterList: false, billable: false },
                  ])
                }
                className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: "var(--pfg-navy)", color: "#fff" }}
              >
                <Plus className="w-3.5 h-3.5" /> Add Row
              </button>
            ) : null
          }
        />
        {toolingItems.length === 0 ? (
          <EmptyState message="No tooling items logged." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Item Description</Th>
                <Th>Task Required For</Th>
                <Th>Purchased</Th>
                <Th>Add to Master List</Th>
                <Th>Billable to Customer</Th>
                {!isReadOnly && <Th></Th>}
              </tr>
            </thead>
            <tbody>
              {toolingItems.map((t, i) => (
                <tr key={i}>
                  <Td>
                    <TdInput
                      value={t.description}
                      onChange={(v) => {
                        const u = [...toolingItems];
                        u[i] = { ...u[i], description: v };
                        setToolingItems(u);
                      }}
                      disabled={isReadOnly}
                      placeholder="Item description"
                    />
                  </Td>
                  <Td>
                    <TdInput
                      value={t.taskFor}
                      onChange={(v) => {
                        const u = [...toolingItems];
                        u[i] = { ...u[i], taskFor: v };
                        setToolingItems(u);
                      }}
                      disabled={isReadOnly}
                      placeholder="Task..."
                    />
                  </Td>
                  <Td>
                    <TdSelect
                      value={t.purchased}
                      onChange={(v) => {
                        const u = [...toolingItems];
                        u[i] = { ...u[i], purchased: v as any };
                        setToolingItems(u);
                      }}
                      options={[
                        { value: "Yes", label: "Yes" },
                        { value: "No", label: "No" },
                        { value: "Ordered by Customer", label: "Ordered by Customer" },
                      ]}
                      disabled={isReadOnly}
                    />
                  </Td>
                  <Td className="text-center">
                    <input
                      type="checkbox"
                      checked={t.masterList}
                      onChange={(e) => {
                        const u = [...toolingItems];
                        u[i] = { ...u[i], masterList: e.target.checked };
                        setToolingItems(u);
                      }}
                      disabled={isReadOnly}
                    />
                  </Td>
                  <Td className="text-center">
                    <input
                      type="checkbox"
                      checked={t.billable}
                      onChange={(e) => {
                        const u = [...toolingItems];
                        u[i] = { ...u[i], billable: e.target.checked };
                        setToolingItems(u);
                      }}
                      disabled={isReadOnly}
                    />
                  </Td>
                  {!isReadOnly && (
                    <Td>
                      <button
                        onClick={() => setToolingItems(toolingItems.filter((_, j) => j !== i))}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>

      {/* 2.7 Financial Summary — hidden from Observer */}
      {!isObserver && (
        <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <SectionHeader title="2.7 — Financial Summary" />
          {workPackages.length === 0 ? (
            <EmptyState message="No work packages configured." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>WP Name</Th>
                  <Th>Planned Start</Th>
                  <Th>Actual Start</Th>
                  <Th>Planned Finish</Th>
                  <Th>Actual Finish</Th>
                  <Th>Contracted Value (€)</Th>
                  <Th>Variations (€)</Th>
                  <Th>Cumulative to Date (€)</Th>
                </tr>
              </thead>
              <tbody>
                {workPackages.map((wp: any) => {
                  const prog = wpProgress.find((p: any) => p.workPackageId === wp.id) || {};
                  const contracted = Number(wp.contractedValue || 0);
                  const variations = Number(prog.variations || 0);
                  const cumulative = contracted + variations;
                  return (
                    <tr key={wp.id}>
                      <Td><span className="font-medium">{wp.name}</span></Td>
                      <Td>{wp.plannedStart || "—"}</Td>
                      <Td>{prog.actualStart || "—"}</Td>
                      <Td>{wp.plannedFinish || "—"}</Td>
                      <Td>{prog.actualFinish || "—"}</Td>
                      <Td>€{contracted.toLocaleString("en-IE", { minimumFractionDigits: 2 })}</Td>
                      <Td>
                        <TdInput
                          type="number"
                          value={variations}
                          onChange={() => {}}
                          disabled={isReadOnly}
                          className="w-28"
                        />
                      </Td>
                      <Td className="font-semibold">
                        €{cumulative.toLocaleString("en-IE", { minimumFractionDigits: 2 })}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}

      {/* Save / Publish controls */}
      {!isReadOnly && (
        <div
          className="sticky bottom-0 rounded-xl border p-4 flex flex-wrap items-center gap-3"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", zIndex: 10 }}
        >
          <label className="flex items-center gap-2 text-[12px] mr-auto">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
            />
            Send email notification to customer
          </label>
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 rounded-lg border disabled:opacity-50"
            style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-navy)" }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save Draft
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ background: "var(--pfg-navy)", color: "#fff" }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save & Publish to Portal
          </button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SUB-TAB 2: Supervisor Reports
// ════════════════════════════════════════════════════════════════════

function SupervisorReportsTab({
  project,
  workers,
  assignments,
  user,
}: {
  project: DashboardProject;
  workers: DashboardWorker[];
  assignments: DashboardAssignment[];
  user: any;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({ workerId: "", date: todayStr(), shift: "Day" });
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [replyText, setReplyText] = useState<Record<number, string>>({});
  const [sendingReply, setSendingReply] = useState<number | null>(null);

  const isAdminOrRM = user?.role === "admin" || user?.role === "resource_manager";

  const projectAssignments = assignments.filter(
    (a) => a.projectId === project.id && ["active", "confirmed", "pending_confirmation"].includes(a.status || "")
  );

  const { data: reports = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: [`/api/projects/${project.id}/supervisor-reports`],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/projects/${project.id}/supervisor-reports`);
        return res.json();
      } catch {
        return [];
      }
    },
  });

  const pendingReports = reports.filter((r: any) => !r.assignedWorkerId);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type === "application/pdf") setSelectedFile(f);
    else toast({ title: "Please drop a PDF file", variant: "destructive" });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setSelectedFile(f);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("workerId", uploadForm.workerId);
      fd.append("date", uploadForm.date);
      fd.append("shift", uploadForm.shift);
      await fetch(`/api/projects/${project.id}/supervisor-reports/upload`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      setSelectedFile(null);
      setUploadForm({ workerId: "", date: todayStr(), shift: "Day" });
      qc.invalidateQueries({ queryKey: [`/api/projects/${project.id}/supervisor-reports`] });
      toast({ title: "Report uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    }
    setUploading(false);
  };

  const handleSendReply = async (reportId: number) => {
    const text = replyText[reportId];
    if (!text?.trim()) return;
    setSendingReply(reportId);
    try {
      await apiRequest("POST", `/api/supervisor-reports/${reportId}/replies`, { text });
      setReplyText({ ...replyText, [reportId]: "" });
      refetch();
      toast({ title: "Reply sent" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
    setSendingReply(null);
  };

  return (
    <div className="space-y-6">
      {/* Pending queue — admin/RM only */}
      {isAdminOrRM && pendingReports.length > 0 && (
        <div
          className="rounded-xl border p-4 flex items-start gap-3"
          style={{ borderColor: "var(--amber)", background: "var(--amber-bg)" }}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--amber)" }} />
          <div className="flex-1">
            <p className="text-[13px] font-semibold" style={{ color: "var(--amber)" }}>
              {pendingReports.length} report{pendingReports.length > 1 ? "s" : ""} need assignment
            </p>
            <div className="mt-2 space-y-1.5">
              {pendingReports.map((r: any) => (
                <div key={r.id} className="flex items-center gap-2 text-[12px]">
                  <span className="font-medium">{fmtDate(r.date)}</span>
                  <span style={{ color: "var(--pfg-steel)" }}>{r.filename || "report.pdf"}</span>
                  <select
                    className="ml-auto text-[11px] px-2 py-0.5 rounded border"
                    style={{ borderColor: "hsl(var(--border))" }}
                    onChange={async (e) => {
                      await apiRequest("PATCH", `/api/supervisor-reports/${r.id}`, { assignedWorkerId: Number(e.target.value) });
                      refetch();
                    }}
                  >
                    <option value="">Assign to...</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Upload area */}
      <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <SectionHeader title="Upload Supervisor Report" />
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-pfg-navy bg-blue-50" : ""}`}
          style={{ borderColor: dragOver ? "var(--pfg-navy)" : "hsl(var(--border))" }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--pfg-steel)" }} />
          <p className="text-[13px] font-semibold" style={{ color: "var(--pfg-navy)" }}>
            Drop PDF here or click to upload
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--pfg-steel)" }}>PDF files only</p>
          <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
        </div>

        {selectedFile && (
          <div className="mt-4 space-y-3">
            <div className="text-[12px] font-semibold" style={{ color: "var(--pfg-navy)" }}>
              Selected: {selectedFile.name}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide block mb-1" style={{ color: "var(--pfg-steel)" }}>
                  Supervisor
                </label>
                <select
                  value={uploadForm.workerId}
                  onChange={(e) => setUploadForm({ ...uploadForm, workerId: e.target.value })}
                  className="w-full px-2 py-1.5 rounded border text-[12px]"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  <option value="">Select worker...</option>
                  {projectAssignments.map((a) => {
                    const w = workers.find((wk) => wk.id === a.workerId);
                    if (!w) return null;
                    return <option key={w.id} value={w.id}>{w.name}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide block mb-1" style={{ color: "var(--pfg-steel)" }}>
                  Date
                </label>
                <input
                  type="date"
                  value={uploadForm.date}
                  onChange={(e) => setUploadForm({ ...uploadForm, date: e.target.value })}
                  className="w-full px-2 py-1.5 rounded border text-[12px]"
                  style={{ borderColor: "hsl(var(--border))" }}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide block mb-1" style={{ color: "var(--pfg-steel)" }}>
                  Shift
                </label>
                <select
                  value={uploadForm.shift}
                  onChange={(e) => setUploadForm({ ...uploadForm, shift: e.target.value })}
                  className="w-full px-2 py-1.5 rounded border text-[12px]"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  <option value="Day">Day</option>
                  <option value="Night">Night</option>
                </select>
              </div>
            </div>
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadForm.workerId}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
              style={{ background: "var(--pfg-navy)", color: "#fff" }}
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Submit Report
            </button>
          </div>
        )}
      </div>

      {/* Report Log */}
      <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <SectionHeader title="Report Log" />
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : reports.length === 0 ? (
          <EmptyState message="No supervisor reports uploaded yet." />
        ) : (
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Shift</Th>
                  <Th>Supervisor</Th>
                  <Th>Method</Th>
                  <Th>Status</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r: any) => {
                  const w = workers.find((wk) => wk.id === r.assignedWorkerId);
                  const isExpanded = expandedRow === r.id;
                  return (
                    <>
                      <tr key={r.id} style={{ borderTop: "1px solid hsl(var(--border))" }}>
                        <Td>{r.date ? fmtDate(r.date) : "—"}</Td>
                        <Td>
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              background: r.shift === "Night" ? "var(--pfg-navy)" : "#fef9c3",
                              color: r.shift === "Night" ? "#fff" : "#713f12",
                            }}
                          >
                            {r.shift || "Day"}
                          </span>
                        </Td>
                        <Td>{w?.name || "Unassigned"}</Td>
                        <Td>
                          <StatusBadge
                            label={r.submissionMethod || "Upload"}
                            color={r.submissionMethod === "Email" ? "blue" : "grey"}
                          />
                        </Td>
                        <Td>
                          <StatusBadge
                            label={r.status || "Received"}
                            color={r.status === "Reviewed" ? "green" : "amber"}
                          />
                        </Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            {r.filePath && (
                              <a
                                href={r.filePath}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-semibold"
                                style={{ color: "var(--pfg-navy)" }}
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </a>
                            )}
                            <button
                              onClick={() => setExpandedRow(isExpanded ? null : r.id)}
                              className="flex items-center gap-1 text-[11px] font-semibold"
                              style={{ color: "var(--pfg-steel)" }}
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              {r.replies?.length || 0}
                            </button>
                          </div>
                        </Td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ borderTop: "1px solid hsl(var(--border))" }}>
                          <td colSpan={6} className="px-4 py-3" style={{ background: "hsl(var(--muted))" }}>
                            <div className="space-y-2 mb-3">
                              {(r.replies || []).length === 0 ? (
                                <p className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>No replies yet.</p>
                              ) : (
                                r.replies.map((rep: any, ri: number) => (
                                  <div key={ri} className="text-[11px] rounded px-2 py-1.5" style={{ background: "hsl(var(--card))" }}>
                                    <span className="font-semibold mr-2">{rep.user}</span>
                                    <span style={{ color: "var(--pfg-steel)" }}>{rep.date}</span>
                                    <p className="mt-0.5">{rep.text}</p>
                                  </div>
                                ))
                              )}
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={replyText[r.id] || ""}
                                onChange={(e) => setReplyText({ ...replyText, [r.id]: e.target.value })}
                                placeholder="Write a reply..."
                                className="flex-1 px-2 py-1.5 rounded border text-[12px]"
                                style={{ borderColor: "hsl(var(--border))" }}
                              />
                              <button
                                onClick={() => handleSendReply(r.id)}
                                disabled={sendingReply === r.id}
                                className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded"
                                style={{ background: "var(--pfg-navy)", color: "#fff" }}
                              >
                                {sendingReply === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                Send
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SUB-TAB 3: QHSE
// ════════════════════════════════════════════════════════════════════

const QHSE_TABS = [
  { key: "toolbox", label: "Toolbox Talks" },
  { key: "observations", label: "Safety Observations" },
  { key: "incidents", label: "Incident Reports" },
];

const OBS_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  Positive: { bg: "var(--green-bg)", text: "var(--green)" },
  Unsafe: { bg: "#fef9c3", text: "#713f12" },
  Negative: { bg: "var(--amber-bg)", text: "var(--amber)" },
  "STOP WORK": { bg: "var(--red-bg)", text: "var(--red)" },
};

const INC_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  "Near Miss": { bg: "#dbeafe", text: "#1d4ed8" },
  "First Aid": { bg: "#fef9c3", text: "#713f12" },
  "Medical Treatment": { bg: "var(--amber-bg)", text: "var(--amber)" },
  LTI: { bg: "var(--red-bg)", text: "var(--red)" },
  "STOP WORK": { bg: "var(--red-bg)", text: "var(--red)" },
};

function QHSETab({
  project,
  workers,
  assignments,
  user,
}: {
  project: DashboardProject;
  workers: DashboardWorker[];
  assignments: DashboardAssignment[];
  user: any;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [qhseTab, setQhseTab] = useState("toolbox");

  // Toolbox talks
  const { data: toolboxTalks = [], isLoading: tbLoading, refetch: refetchTB } = useQuery<any[]>({
    queryKey: [`/api/projects/${project.id}/qhse/toolbox-talks`],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/projects/${project.id}/qhse/toolbox-talks`);
        return res.json();
      } catch { return []; }
    },
  });

  // Safety observations
  const { data: observations = [], isLoading: obsLoading, refetch: refetchObs } = useQuery<any[]>({
    queryKey: [`/api/projects/${project.id}/qhse/observations`],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/projects/${project.id}/qhse/observations`);
        return res.json();
      } catch { return []; }
    },
  });

  // Incidents
  const { data: incidents = [], isLoading: incLoading, refetch: refetchInc } = useQuery<any[]>({
    queryKey: [`/api/projects/${project.id}/qhse/incidents`],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/projects/${project.id}/qhse/incidents`);
        return res.json();
      } catch { return []; }
    },
  });

  // Toolbox Talks modal state
  const [showTBModal, setShowTBModal] = useState(false);
  const [tbForm, setTBForm] = useState({ date: todayStr(), shift: "Day", topic: "", attendeeCount: "", notes: "" });
  const [tbFile, setTBFile] = useState<File | null>(null);

  // Observation modal state
  const [showObsModal, setShowObsModal] = useState(false);
  const [obsForm, setObsForm] = useState({
    date: todayStr(), time: "08:00", shift: "Day", type: "Positive",
    reportedBy: "", location: "", description: "", status: "Open",
  });

  // Incident modal state
  const [showIncModal, setShowIncModal] = useState(false);
  const [incForm, setIncForm] = useState({
    date: todayStr(), type: "Near Miss", workerInvolved: "",
    lostTime: false, description: "", status: "Open", rootCause: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSaveTB = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(tbForm).forEach(([k, v]) => fd.append(k, String(v)));
      if (tbFile) fd.append("file", tbFile);
      await fetch(`/api/projects/${project.id}/qhse/toolbox-talks`, {
        method: "POST", credentials: "include", body: fd,
      });
      setShowTBModal(false);
      refetchTB();
      toast({ title: "Toolbox talk logged" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleSaveObs = async () => {
    setSaving(true);
    try {
      await apiRequest("POST", `/api/projects/${project.id}/qhse/observations`, obsForm);
      setShowObsModal(false);
      refetchObs();
      toast({ title: "Observation logged" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleSaveInc = async () => {
    setSaving(true);
    try {
      await apiRequest("POST", `/api/projects/${project.id}/qhse/incidents`, incForm);
      setShowIncModal(false);
      refetchInc();
      toast({ title: "Incident logged" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const projectWorkers = assignments
    .filter((a) => a.projectId === project.id)
    .map((a) => workers.find((w) => w.id === a.workerId))
    .filter(Boolean) as DashboardWorker[];

  return (
    <div className="space-y-4">
      {/* QHSE sub-nav */}
      <div className="flex gap-1 border-b" style={{ borderColor: "hsl(var(--border))" }}>
        {QHSE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setQhseTab(t.key)}
            className="px-4 py-2 text-[12px] font-semibold border-b-2 transition-colors"
            style={{
              borderColor: qhseTab === t.key ? "var(--pfg-gold, #d4a017)" : "transparent",
              color: qhseTab === t.key ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 3.1 Toolbox Talks */}
      {qhseTab === "toolbox" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowTBModal(true)}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: "var(--pfg-navy)", color: "#fff" }}
            >
              <Plus className="w-3.5 h-3.5" /> Log Toolbox Talk
            </button>
          </div>
          {tbLoading ? <Skeleton className="h-32" /> : toolboxTalks.length === 0 ? (
            <EmptyState message="No toolbox talks logged yet." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Shift</Th>
                  <Th>Supervisor</Th>
                  <Th>Topic</Th>
                  <Th>Attendees</Th>
                  <Th>File</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {toolboxTalks.map((t: any, i: number) => (
                  <tr key={i} style={{ borderTop: "1px solid hsl(var(--border))" }}>
                    <Td>{t.date ? fmtDate(t.date) : "—"}</Td>
                    <Td>{t.shift}</Td>
                    <Td>{t.supervisor || "—"}</Td>
                    <Td>{t.topic}</Td>
                    <Td>{t.attendeeCount}</Td>
                    <Td>
                      {t.filePath ? (
                        <a href={t.filePath} target="_blank" rel="noreferrer" className="text-[11px] font-semibold" style={{ color: "var(--pfg-navy)" }}>
                          View
                        </a>
                      ) : "—"}
                    </Td>
                    <Td>{t.notes || "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}

      {/* 3.2 Safety Observations */}
      {qhseTab === "observations" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowObsModal(true)}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: "var(--pfg-navy)", color: "#fff" }}
            >
              <Plus className="w-3.5 h-3.5" /> Log Observation
            </button>
          </div>
          {obsLoading ? <Skeleton className="h-32" /> : observations.length === 0 ? (
            <EmptyState message="No safety observations logged yet." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Date/Time</Th>
                  <Th>Shift</Th>
                  <Th>Type</Th>
                  <Th>Reported By</Th>
                  <Th>Location</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {observations.map((o: any, i: number) => {
                  const color = OBS_TYPE_COLORS[o.type] || OBS_TYPE_COLORS.Positive;
                  const isStop = o.type === "STOP WORK";
                  return (
                    <tr
                      key={i}
                      style={{
                        borderTop: "1px solid hsl(var(--border))",
                        background: isStop ? "var(--red-bg)" : undefined,
                      }}
                    >
                      <Td>{o.date ? fmtDate(o.date) : "—"} {o.time || ""}</Td>
                      <Td>{o.shift}</Td>
                      <Td>
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: color.bg, color: color.text }}
                        >
                          {o.type}
                        </span>
                      </Td>
                      <Td>{o.reportedBy}</Td>
                      <Td>{o.location}</Td>
                      <Td>
                        <StatusBadge
                          label={o.status || "Open"}
                          color={o.status === "Closed" ? "green" : "amber"}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}

      {/* 3.3 Incident Reports */}
      {qhseTab === "incidents" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowIncModal(true)}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: "var(--red)", color: "#fff" }}
            >
              <Plus className="w-3.5 h-3.5" /> Log Incident
            </button>
          </div>
          {incLoading ? <Skeleton className="h-32" /> : incidents.length === 0 ? (
            <EmptyState message="No incidents logged." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Worker Involved</Th>
                  <Th>Lost Time</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc: any, i: number) => {
                  const color = INC_TYPE_COLORS[inc.type] || INC_TYPE_COLORS["Near Miss"];
                  const isLTI = inc.lostTime || inc.type === "LTI";
                  return (
                    <tr
                      key={i}
                      style={{
                        borderTop: "1px solid hsl(var(--border))",
                        background: isLTI ? "var(--red-bg)" : undefined,
                      }}
                    >
                      <Td>{inc.date ? fmtDate(inc.date) : "—"}</Td>
                      <Td>
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: color.bg, color: color.text }}
                        >
                          {inc.type}
                        </span>
                      </Td>
                      <Td>{inc.workerInvolved || "—"}</Td>
                      <Td>
                        {isLTI ? (
                          <StatusBadge label="Yes" color="red" />
                        ) : (
                          <span className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>No</span>
                        )}
                      </Td>
                      <Td>
                        <StatusBadge
                          label={inc.status || "Open"}
                          color={inc.status === "Closed" ? "green" : inc.status === "Under Investigation" ? "amber" : "red"}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}

      {/* Toolbox Talk Modal */}
      {showTBModal && (
        <Modal title="Log Toolbox Talk" onClose={() => setShowTBModal(false)}>
          <div className="space-y-3">
            <ModalField label="Date">
              <input type="date" value={tbForm.date} onChange={(e) => setTBForm({ ...tbForm, date: e.target.value })} className="modal-input" />
            </ModalField>
            <ModalField label="Shift">
              <select value={tbForm.shift} onChange={(e) => setTBForm({ ...tbForm, shift: e.target.value })} className="modal-input">
                <option>Day</option>
                <option>Night</option>
              </select>
            </ModalField>
            <ModalField label="Topic">
              <input type="text" value={tbForm.topic} onChange={(e) => setTBForm({ ...tbForm, topic: e.target.value })} className="modal-input" placeholder="TBT topic" />
            </ModalField>
            <ModalField label="Attendee Count">
              <input type="number" value={tbForm.attendeeCount} onChange={(e) => setTBForm({ ...tbForm, attendeeCount: e.target.value })} className="modal-input" />
            </ModalField>
            <ModalField label="Notes">
              <textarea value={tbForm.notes} onChange={(e) => setTBForm({ ...tbForm, notes: e.target.value })} className="modal-input" rows={3} />
            </ModalField>
            <ModalField label="File (optional)">
              <input type="file" accept="application/pdf,image/*" onChange={(e) => setTBFile(e.target.files?.[0] || null)} className="text-[12px]" />
            </ModalField>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowTBModal(false)} className="text-[12px] px-4 py-2 rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>Cancel</button>
              <button onClick={handleSaveTB} disabled={saving} className="text-[12px] font-semibold px-4 py-2 rounded-lg disabled:opacity-50" style={{ background: "var(--pfg-navy)", color: "#fff" }}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Observation Modal */}
      {showObsModal && (
        <Modal title="Log Safety Observation" onClose={() => setShowObsModal(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <ModalField label="Date">
                <input type="date" value={obsForm.date} onChange={(e) => setObsForm({ ...obsForm, date: e.target.value })} className="modal-input" />
              </ModalField>
              <ModalField label="Time">
                <input type="time" value={obsForm.time} onChange={(e) => setObsForm({ ...obsForm, time: e.target.value })} className="modal-input" />
              </ModalField>
            </div>
            <ModalField label="Shift">
              <select value={obsForm.shift} onChange={(e) => setObsForm({ ...obsForm, shift: e.target.value })} className="modal-input">
                <option>Day</option>
                <option>Night</option>
              </select>
            </ModalField>
            <ModalField label="Type">
              <select value={obsForm.type} onChange={(e) => setObsForm({ ...obsForm, type: e.target.value })} className="modal-input">
                <option>Positive</option>
                <option>Unsafe</option>
                <option>Negative</option>
                <option>STOP WORK</option>
              </select>
            </ModalField>
            <ModalField label="Reported By">
              <select value={obsForm.reportedBy} onChange={(e) => setObsForm({ ...obsForm, reportedBy: e.target.value })} className="modal-input">
                <option value="">Select...</option>
                {projectWorkers.map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
              </select>
            </ModalField>
            <ModalField label="Location">
              <input type="text" value={obsForm.location} onChange={(e) => setObsForm({ ...obsForm, location: e.target.value })} className="modal-input" placeholder="Location on site" />
            </ModalField>
            <ModalField label="Description">
              <textarea value={obsForm.description} onChange={(e) => setObsForm({ ...obsForm, description: e.target.value })} className="modal-input" rows={3} />
            </ModalField>
            <ModalField label="Status">
              <select value={obsForm.status} onChange={(e) => setObsForm({ ...obsForm, status: e.target.value })} className="modal-input">
                <option>Open</option>
                <option>Closed</option>
                <option>Under Investigation</option>
              </select>
            </ModalField>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowObsModal(false)} className="text-[12px] px-4 py-2 rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>Cancel</button>
              <button onClick={handleSaveObs} disabled={saving} className="text-[12px] font-semibold px-4 py-2 rounded-lg disabled:opacity-50" style={{ background: "var(--pfg-navy)", color: "#fff" }}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Incident Modal */}
      {showIncModal && (
        <Modal title="Log Incident" onClose={() => setShowIncModal(false)}>
          <div className="space-y-3">
            <ModalField label="Date">
              <input type="date" value={incForm.date} onChange={(e) => setIncForm({ ...incForm, date: e.target.value })} className="modal-input" />
            </ModalField>
            <ModalField label="Type">
              <select value={incForm.type} onChange={(e) => setIncForm({ ...incForm, type: e.target.value })} className="modal-input">
                <option>Near Miss</option>
                <option>First Aid</option>
                <option>Medical Treatment</option>
                <option>LTI</option>
                <option>STOP WORK</option>
              </select>
            </ModalField>
            <ModalField label="Worker Involved">
              <select value={incForm.workerInvolved} onChange={(e) => setIncForm({ ...incForm, workerInvolved: e.target.value })} className="modal-input">
                <option value="">Select...</option>
                {projectWorkers.map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
              </select>
            </ModalField>
            <ModalField label="Lost Time Incident?">
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={incForm.lostTime} onChange={(e) => setIncForm({ ...incForm, lostTime: e.target.checked })} />
                Yes — this is a Lost Time Incident
              </label>
            </ModalField>
            <ModalField label="Description">
              <textarea value={incForm.description} onChange={(e) => setIncForm({ ...incForm, description: e.target.value })} className="modal-input" rows={3} />
            </ModalField>
            <ModalField label="Root Cause (if known)">
              <textarea value={incForm.rootCause} onChange={(e) => setIncForm({ ...incForm, rootCause: e.target.value })} className="modal-input" rows={2} />
            </ModalField>
            <ModalField label="Status">
              <select value={incForm.status} onChange={(e) => setIncForm({ ...incForm, status: e.target.value })} className="modal-input">
                <option>Open</option>
                <option>Under Investigation</option>
                <option>Closed</option>
              </select>
            </ModalField>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowIncModal(false)} className="text-[12px] px-4 py-2 rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>Cancel</button>
              <button onClick={handleSaveInc} disabled={saving} className="text-[12px] font-semibold px-4 py-2 rounded-lg disabled:opacity-50" style={{ background: "var(--red)", color: "#fff" }}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "Save Incident"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Modal + ModalField helpers ───────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <h3 className="text-[14px] font-semibold" style={{ color: "var(--pfg-navy)" }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/5">
            <XCircle className="w-4 h-4" style={{ color: "var(--pfg-steel)" }} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wide block mb-1" style={{ color: "var(--pfg-steel)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SUB-TAB 4: Safety KPIs
// ════════════════════════════════════════════════════════════════════

function SafetyKPIsTab({ project }: { project: DashboardProject }) {
  // Load all QHSE data for calculations
  const { data: observations = [] } = useQuery<any[]>({
    queryKey: [`/api/projects/${project.id}/qhse/observations`],
    queryFn: async () => {
      try { const r = await apiRequest("GET", `/api/projects/${project.id}/qhse/observations`); return r.json(); }
      catch { return []; }
    },
  });
  const { data: incidents = [] } = useQuery<any[]>({
    queryKey: [`/api/projects/${project.id}/qhse/incidents`],
    queryFn: async () => {
      try { const r = await apiRequest("GET", `/api/projects/${project.id}/qhse/incidents`); return r.json(); }
      catch { return []; }
    },
  });
  const { data: toolboxTalks = [] } = useQuery<any[]>({
    queryKey: [`/api/projects/${project.id}/qhse/toolbox-talks`],
    queryFn: async () => {
      try { const r = await apiRequest("GET", `/api/projects/${project.id}/qhse/toolbox-talks`); return r.json(); }
      catch { return []; }
    },
  });

  // Calculate KPIs from data
  const kpis = useMemo(() => {
    const totalObs = observations.length;
    const positiveObs = observations.filter((o: any) => o.type === "Positive").length;
    const unsafeObs = observations.filter((o: any) => o.type === "Unsafe").length;
    const negativeObs = observations.filter((o: any) => o.type === "Negative").length;
    const stopWorkObs = observations.filter((o: any) => o.type === "STOP WORK").length;

    const totalInc = incidents.length;
    const ltiCount = incidents.filter((i: any) => i.lostTime || i.type === "LTI").length;
    const nearMisses = incidents.filter((i: any) => i.type === "Near Miss").length;
    const stopWorkInc = incidents.filter((i: any) => i.type === "STOP WORK").length;

    // LTIFR = (LTI count × 1,000,000) / (workers × hours worked)
    // Simplified: assume 8hr days and use project duration
    const LTIFR = ltiCount > 0 ? +(ltiCount * 1_000_000 / Math.max(1, totalInc * 8)).toFixed(2) : 0;

    const positiveRate = totalObs > 0 ? Math.round((positiveObs / totalObs) * 100) : 0;

    // Safety participation: unique reporters / total (placeholder logic)
    const uniqueReporters = new Set(observations.map((o: any) => o.reportedBy).filter(Boolean)).size;
    const participationRate = uniqueReporters > 0 ? Math.min(100, Math.round((uniqueReporters / Math.max(1, observations.length)) * 100)) : 0;

    // TBT compliance: days with TBT / total project days
    const totalDays = project.startDate && project.endDate
      ? Math.max(1, Math.ceil((new Date(project.endDate).getTime() - new Date(project.startDate).getTime()) / 86400000))
      : 1;
    const tbtCompliance = Math.min(100, Math.round((toolboxTalks.length / totalDays) * 100));

    return {
      LTIFR,
      totalInc,
      nearMisses,
      unsafeObs,
      stopWork: stopWorkObs + stopWorkInc,
      totalObs,
      participationRate,
      positiveRate,
      tbtCompliance,
    };
  }, [observations, incidents, toolboxTalks, project]);

  const KPICard = ({
    label, value, unit, color, large,
  }: {
    label: string;
    value: string | number;
    unit?: string;
    color: "green" | "amber" | "red" | "navy" | "grey";
    large?: boolean;
  }) => {
    const colorMap = {
      green: "var(--green)",
      amber: "var(--amber)",
      red: "var(--red)",
      navy: "var(--pfg-navy)",
      grey: "var(--pfg-steel)",
    };
    return (
      <div className="rounded-xl border p-5 text-center" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <div
          className={`font-bold font-display ${large ? "text-4xl" : "text-2xl"}`}
          style={{ color: colorMap[color] }}
        >
          {value}
          {unit && <span className="text-lg ml-1">{unit}</span>}
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide mt-1" style={{ color: "var(--pfg-steel)" }}>
          {label}
        </div>
      </div>
    );
  };

  const participationColor: "green" | "amber" | "red" =
    kpis.participationRate >= 50 ? "green" : kpis.participationRate >= 25 ? "amber" : "red";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <KPICard
          label="LTIFR"
          value={kpis.LTIFR}
          color={kpis.LTIFR > 0 ? "red" : "green"}
          large
        />
        <KPICard label="Total Recordable Incidents" value={kpis.totalInc} color={kpis.totalInc > 0 ? "amber" : "green"} />
        <KPICard label="Near Misses" value={kpis.nearMisses} color={kpis.nearMisses > 0 ? "amber" : "green"} />
        <KPICard label="Unsafe Conditions Reported" value={kpis.unsafeObs} color={kpis.unsafeObs > 0 ? "amber" : "green"} />
        <KPICard
          label="STOP WORK Events"
          value={kpis.stopWork}
          color={kpis.stopWork > 0 ? "red" : "green"}
          large
        />
        <KPICard label="Total Safety Observations" value={kpis.totalObs} color="navy" />
        <KPICard label="Safety Participation Rate" value={kpis.participationRate} unit="%" color={participationColor} />
        <KPICard label="Positive Observation Rate" value={kpis.positiveRate} unit="%" color={kpis.positiveRate >= 50 ? "green" : "amber"} />
        <KPICard label="TBT Compliance Rate" value={kpis.tbtCompliance} unit="%" color={kpis.tbtCompliance >= 80 ? "green" : kpis.tbtCompliance >= 50 ? "amber" : "red"} />
      </div>

      {kpis.stopWork > 0 && (
        <div
          className="rounded-xl border p-4 flex items-start gap-3"
          style={{ borderColor: "var(--red)", background: "var(--red-bg)" }}
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "var(--red)" }} />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "var(--red)" }}>
              {kpis.stopWork} STOP WORK Event{kpis.stopWork > 1 ? "s" : ""} recorded
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--red)" }}>
              Review all STOP WORK entries in the QHSE tab and ensure root cause analysis is complete.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════

export default function DailyReportHub({ project, workers, assignments, user }: DailyReportHubProps) {
  const [activeSubTab, setActiveSubTab] = useState("pm");

  return (
    <div className="space-y-0">
      {/* Sub-tab navigation */}
      <div className="flex border-b mb-5 overflow-x-auto" style={{ borderColor: "hsl(var(--border))" }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveSubTab(t.key)}
            className="flex items-center gap-1.5 px-4 py-3 text-[12px] font-semibold border-b-[3px] transition-colors whitespace-nowrap shrink-0"
            style={{
              borderColor: activeSubTab === t.key ? "var(--pfg-gold, #d4a017)" : "transparent",
              color: activeSubTab === t.key ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
              background: activeSubTab === t.key ? "hsl(var(--accent))" : "transparent",
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      {activeSubTab === "pm" && (
        <PMReportTab project={project} workers={workers} assignments={assignments} user={user} />
      )}
      {activeSubTab === "supervisor" && (
        <SupervisorReportsTab project={project} workers={workers} assignments={assignments} user={user} />
      )}
      {activeSubTab === "qhse" && (
        <QHSETab project={project} workers={workers} assignments={assignments} user={user} />
      )}
      {activeSubTab === "kpis" && (
        <SafetyKPIsTab project={project} />
      )}
    </div>
  );
}
