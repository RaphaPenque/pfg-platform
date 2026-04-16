import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DashboardProject, DashboardWorker, DashboardAssignment } from "@/hooks/use-dashboard-data";
import {
  Award, CheckCircle2, Clock, XCircle, ChevronDown, ChevronRight,
  Download, Loader2, Send, FilePlus, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────

interface WorkPackage {
  id: number;
  name: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  contractedValue: number | null;
}

interface MilestoneCertificate {
  id: number;
  projectId: number;
  milestoneNumber: string;
  workPackageId: number | null;
  workPackageName: string | null;
  status: "draft" | "sent" | "approved" | "rejected";
  contractedValue: number | null;
  variationsClaimed: number | null;
  totalValue: number | null;
  comments: string | null;
  // Scope checkboxes
  scopeMechanicalCompletion: boolean;
  scopeInspectionQa: boolean;
  scopeTesting: boolean;
  scopeDocumentationSubmitted: boolean;
  scopeMinorSnaggingClosed: boolean;
  // Approval
  approverName: string | null;
  approverEmail: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  signedPdfPath: string | null;
  // Dates
  sentAt: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  draft: { label: "Draft", bg: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" },
  sent: { label: "Sent", bg: "var(--amber-bg)", color: "var(--amber)" },
  approved: { label: "Approved", bg: "var(--green-bg)", color: "var(--green)" },
  rejected: { label: "Rejected", bg: "var(--red-bg)", color: "var(--red)" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] || STATUS_BADGE.draft;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Scope checkbox labels ────────────────────────────────────────────

const SCOPE_ITEMS = [
  { key: "scopeMechanicalCompletion", label: "Mechanical Completion" },
  { key: "scopeInspectionQa", label: "Inspection / QA" },
  { key: "scopeTesting", label: "Testing" },
  { key: "scopeDocumentationSubmitted", label: "Documentation Submitted" },
  { key: "scopeMinorSnaggingClosed", label: "Minor Snagging Closed" },
] as const;

// ─── Certificate Detail Expanded View ────────────────────────────────

function CertificateDetail({ cert }: { cert: MilestoneCertificate }) {
  const total = (cert.contractedValue || 0) + (cert.variationsClaimed || 0);
  return (
    <div className="bg-white rounded-xl border p-5 mt-2 space-y-4" style={{ borderColor: "hsl(var(--border))" }}>
      <div className="grid grid-cols-3 gap-4 text-[13px]">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--pfg-steel)" }}>Contracted Value</div>
          <div className="font-semibold text-pfg-navy">{fmt(cert.contractedValue)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--pfg-steel)" }}>Variations Claimed</div>
          <div className="font-semibold text-pfg-navy">{fmt(cert.variationsClaimed)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--pfg-steel)" }}>Total Value</div>
          <div className="text-lg font-bold text-pfg-navy">{fmt(total)}</div>
        </div>
      </div>

      {/* Scope completion */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--pfg-steel)" }}>Scope Completion</div>
        <div className="grid grid-cols-2 gap-1.5">
          {SCOPE_ITEMS.map(({ key, label }) => {
            const checked = cert[key as keyof MilestoneCertificate] as boolean;
            return (
              <div key={key} className="flex items-center gap-2 text-[12px]">
                <div
                  className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                  style={{ background: checked ? "var(--green-bg)" : "hsl(var(--muted))", border: checked ? "none" : "1px solid hsl(var(--border))" }}
                >
                  {checked && <CheckCircle2 className="w-3 h-3" style={{ color: "var(--green)" }} />}
                </div>
                <span style={{ color: checked ? "var(--pfg-navy)" : "var(--pfg-steel)" }}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Comments */}
      {cert.comments && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--pfg-steel)" }}>Comments / Exceptions</div>
          <p className="text-[12px] text-pfg-navy leading-relaxed">{cert.comments}</p>
        </div>
      )}

      {/* Approval timeline */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--pfg-steel)" }}>Status Timeline</div>
        <div className="flex items-center gap-3 text-[11px]">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: "var(--green)" }} />
            <span className="text-pfg-navy">Draft created {fmtDate(cert.createdAt)}</span>
          </div>
          {cert.sentAt && (
            <>
              <div className="w-4 h-px" style={{ background: "hsl(var(--border))" }} />
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: "var(--amber)" }} />
                <span className="text-pfg-navy">Sent {fmtDate(cert.sentAt)}</span>
              </div>
            </>
          )}
          {cert.status === "approved" && cert.approvedAt && (
            <>
              <div className="w-4 h-px" style={{ background: "hsl(var(--border))" }} />
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: "var(--green)" }} />
                <span className="text-pfg-navy">Approved {fmtDate(cert.approvedAt)}</span>
              </div>
            </>
          )}
          {cert.status === "rejected" && (
            <>
              <div className="w-4 h-px" style={{ background: "hsl(var(--border))" }} />
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: "var(--red)" }} />
                <span className="text-pfg-navy">Rejected</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Approval details */}
      {cert.status === "approved" && (
        <div className="rounded-lg p-3" style={{ background: "var(--green-bg)" }}>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4" style={{ color: "var(--green)" }} />
            <span className="text-[12px] font-bold" style={{ color: "var(--green)" }}>Certificate Approved</span>
          </div>
          <div className="text-[11px] space-y-0.5" style={{ color: "var(--green)" }}>
            {cert.approverName && <div>Approved by: <strong>{cert.approverName}</strong></div>}
            {cert.approverEmail && <div>Email: {cert.approverEmail}</div>}
            {cert.approvedAt && <div>Date: {fmtDate(cert.approvedAt)}</div>}
          </div>
        </div>
      )}

      {cert.status === "rejected" && cert.rejectionReason && (
        <div className="rounded-lg p-3" style={{ background: "var(--red-bg)" }}>
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4" style={{ color: "var(--red)" }} />
            <span className="text-[12px] font-bold" style={{ color: "var(--red)" }}>Rejected</span>
          </div>
          <p className="text-[11px]" style={{ color: "var(--red)" }}>{cert.rejectionReason}</p>
        </div>
      )}

      {/* Download */}
      {cert.signedPdfPath && (
        <a
          href={cert.signedPdfPath}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-[12px] font-semibold px-3 py-2 rounded-lg"
          style={{ background: "var(--pfg-navy)", color: "#fff" }}
        >
          <Download className="w-3.5 h-3.5" />
          Download Signed PDF
        </a>
      )}
    </div>
  );
}

// ─── Generate Certificate Modal ───────────────────────────────────────

interface GenerateModalProps {
  project: DashboardProject;
  certificates: MilestoneCertificate[];
  onClose: () => void;
  onSaved: (cert: MilestoneCertificate) => void;
}

function GenerateModal({ project, certificates, onClose, onSaved }: GenerateModalProps) {
  const { toast } = useToast();

  const { data: workPackages = [], isLoading: wpLoading } = useQuery<WorkPackage[]>({
    queryKey: [`/api/projects/${project.id}/work-packages`],
    retry: false,
  });

  const nextNum = certificates.length + 1;
  const milestoneNumber = `M${nextNum}`;

  const [selectedWpId, setSelectedWpId] = useState<number | "">("");
  const [scope, setScope] = useState({
    scopeMechanicalCompletion: false,
    scopeInspectionQa: false,
    scopeTesting: false,
    scopeDocumentationSubmitted: false,
    scopeMinorSnaggingClosed: false,
  });
  const [variationsClaimed, setVariationsClaimed] = useState("");
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [savedCert, setSavedCert] = useState<MilestoneCertificate | null>(null);

  const selectedWp = workPackages.find(w => w.id === selectedWpId) || null;

  const handleSaveDraft = useCallback(async () => {
    setSaving(true);
    try {
      const payload = {
        milestoneNumber,
        workPackageId: selectedWpId || null,
        workPackageName: selectedWp?.name || null,
        contractedValue: selectedWp?.contractedValue || null,
        variationsClaimed: variationsClaimed ? parseFloat(variationsClaimed) : null,
        comments: comments || null,
        ...scope,
      };
      const res = await apiRequest("POST", `/api/projects/${project.id}/milestone-certificates`, payload);
      const cert: MilestoneCertificate = await res.json();
      setSavedCert(cert);
      onSaved(cert);
      toast({ title: "Draft saved", description: `Certificate ${cert.milestoneNumber} created.` });
    } catch (e: any) {
      toast({ title: "Error saving draft", description: e.message || "Unknown error", variant: "destructive" });
    }
    setSaving(false);
  }, [milestoneNumber, selectedWpId, selectedWp, variationsClaimed, comments, scope, project.id, onSaved, toast]);

  const handleSendForApproval = useCallback(async () => {
    if (!savedCert) return;
    setSending(true);
    try {
      const res = await apiRequest("POST", `/api/milestone-certificates/${savedCert.id}/send`);
      const updated: MilestoneCertificate = await res.json();
      onSaved(updated);
      toast({ title: "Sent for approval", description: "Email sent to project stakeholders." });
      onClose();
    } catch (e: any) {
      toast({ title: "Error sending", description: e.message || "Unknown error", variant: "destructive" });
    }
    setSending(false);
  }, [savedCert, onSaved, onClose, toast]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", maxHeight: "90vh", overflowY: "auto" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))", background: "var(--pfg-navy)" }}>
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-white" />
            <span className="text-[14px] font-bold text-white font-display">Generate Milestone Certificate</span>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Milestone number */}
          <div className="flex items-center gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Milestone Number</div>
            <span className="text-[13px] font-bold text-pfg-navy px-2.5 py-0.5 rounded-full" style={{ background: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}>
              {milestoneNumber}
            </span>
          </div>

          {/* Work Package */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--pfg-steel)" }}>
              Work Package
            </label>
            {wpLoading ? (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--pfg-steel)" }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading work packages...
              </div>
            ) : (
              <select
                className="w-full rounded-lg px-3 py-2 text-[13px] border"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "var(--pfg-navy)" }}
                value={selectedWpId}
                onChange={(e) => setSelectedWpId(e.target.value ? parseInt(e.target.value) : "")}
              >
                <option value="">— Select work package —</option>
                {workPackages.map(wp => (
                  <option key={wp.id} value={wp.id}>{wp.name}</option>
                ))}
                {workPackages.length === 0 && <option disabled>No work packages configured</option>}
              </select>
            )}
          </div>

          {/* Pre-filled WP details (read-only) */}
          {selectedWp && (
            <div className="rounded-lg p-3 space-y-2" style={{ background: "hsl(var(--muted))" }}>
              <div className="grid grid-cols-3 gap-3 text-[12px]">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--pfg-steel)" }}>Start Date</div>
                  <div className="font-medium text-pfg-navy">{fmtDate(selectedWp.plannedStartDate)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--pfg-steel)" }}>End Date</div>
                  <div className="font-medium text-pfg-navy">{fmtDate(selectedWp.plannedEndDate)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--pfg-steel)" }}>Contracted Value</div>
                  <div className="font-bold text-pfg-navy">{fmt(selectedWp.contractedValue)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Scope completion */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide block mb-2" style={{ color: "var(--pfg-steel)" }}>
              Scope Completion
            </label>
            <div className="space-y-2">
              {SCOPE_ITEMS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={scope[key as keyof typeof scope]}
                    onChange={(e) => setScope(prev => ({ ...prev, [key]: e.target.checked }))}
                    className="w-4 h-4 rounded accent-pfg-navy"
                  />
                  <span className="text-[13px] text-pfg-navy">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Variations */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--pfg-steel)" }}>
              Variations Claimed (€)
            </label>
            <input
              type="number"
              min="0"
              step="100"
              value={variationsClaimed}
              onChange={(e) => setVariationsClaimed(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg px-3 py-2 text-[13px] border"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "var(--pfg-navy)" }}
            />
          </div>

          {/* Comments */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--pfg-steel)" }}>
              Comments / Exceptions
            </label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              placeholder="Any exceptions or notes..."
              className="w-full rounded-lg px-3 py-2 text-[13px] border resize-none"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "var(--pfg-navy)" }}
            />
          </div>

          {/* Totals preview */}
          {(selectedWp?.contractedValue || variationsClaimed) && (
            <div className="rounded-lg p-3" style={{ background: "hsl(var(--muted))" }}>
              <div className="flex justify-between text-[12px] mb-1">
                <span style={{ color: "var(--pfg-steel)" }}>Contracted Value</span>
                <span className="font-medium text-pfg-navy">{fmt(selectedWp?.contractedValue || 0)}</span>
              </div>
              <div className="flex justify-between text-[12px] mb-1">
                <span style={{ color: "var(--pfg-steel)" }}>Variations Claimed</span>
                <span className="font-medium text-pfg-navy">{fmt(variationsClaimed ? parseFloat(variationsClaimed) : 0)}</span>
              </div>
              <div className="flex justify-between text-[13px] font-bold border-t pt-1 mt-1" style={{ borderColor: "hsl(var(--border))" }}>
                <span className="text-pfg-navy">Total</span>
                <span className="text-pfg-navy">
                  {fmt((selectedWp?.contractedValue || 0) + (variationsClaimed ? parseFloat(variationsClaimed) : 0))}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-5 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <button
            onClick={onClose}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg border"
            style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveDraft}
              disabled={saving || !!savedCert}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border disabled:opacity-50"
              style={{ borderColor: "var(--pfg-navy)", color: "var(--pfg-navy)" }}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FilePlus className="w-3.5 h-3.5" />}
              Save Draft
            </button>
            <button
              onClick={handleSendForApproval}
              disabled={!savedCert || sending}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-4 py-1.5 rounded-lg disabled:opacity-40"
              style={{ background: "var(--pfg-navy)", color: "#fff" }}
              title={!savedCert ? "Save draft first" : "Send for approval"}
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send for Approval
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────

interface Props {
  project: DashboardProject;
  user: any;
  workers: DashboardWorker[];
  assignments: DashboardAssignment[];
}

export default function MilestoneCertificateTab({ project, user }: Props) {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const canGenerate = user?.role === "admin" || user?.role === "resource_manager" || user?.role === "project_manager";

  const {
    data: certificates = [],
    isLoading,
    refetch,
  } = useQuery<MilestoneCertificate[]>({
    queryKey: [`/api/projects/${project.id}/milestone-certificates`],
    retry: false,
  });

  const handleSaved = useCallback((_cert: MilestoneCertificate) => {
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-[13px]" style={{ color: "var(--pfg-steel)" }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading certificates...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4" style={{ color: "var(--pfg-yellow-dark)" }} />
          <h3 className="text-[14px] font-bold text-pfg-navy font-display">Milestone Certificates</h3>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: "hsl(var(--muted))", color: "var(--pfg-steel)" }}
          >
            {certificates.length}
          </span>
        </div>
        {canGenerate && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: "var(--pfg-navy)", color: "#fff" }}
          >
            <FilePlus className="w-3.5 h-3.5" />
            Generate Certificate
          </button>
        )}
      </div>

      {/* Table */}
      {certificates.length === 0 ? (
        <div className="rounded-xl border p-10 text-center" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <Award className="w-8 h-8 mx-auto mb-3 opacity-30" style={{ color: "var(--pfg-navy)" }} />
          <p className="text-[13px] font-semibold text-pfg-navy mb-1">No milestone certificates yet</p>
          <p className="text-[12px]" style={{ color: "var(--pfg-steel)" }}>
            {canGenerate ? "Click \"Generate Certificate\" to create the first one." : "Certificates will appear here once created."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ background: "hsl(var(--muted))" }}>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-6" style={{ color: "hsl(var(--muted-foreground))" }} />
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>Milestone #</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>Work Package</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>Status</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>Value</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>Variations</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((cert) => {
                const isExpanded = expandedId === cert.id;
                return (
                  <>
                    <tr
                      key={cert.id}
                      className="cursor-pointer hover:bg-black/[0.02] transition-colors"
                      style={{ borderTop: "1px solid hsl(var(--border))" }}
                      onClick={() => setExpandedId(isExpanded ? null : cert.id)}
                    >
                      <td className="px-3 py-3 text-center">
                        {isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5 inline" style={{ color: "var(--pfg-steel)" }} />
                          : <ChevronRight className="w-3.5 h-3.5 inline" style={{ color: "var(--pfg-steel)" }} />
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-pfg-navy">{cert.milestoneNumber}</span>
                      </td>
                      <td className="px-4 py-3 text-pfg-navy">{cert.workPackageName || <span style={{ color: "var(--pfg-steel)" }}>—</span>}</td>
                      <td className="px-4 py-3"><StatusBadge status={cert.status} /></td>
                      <td className="px-4 py-3 text-right font-medium text-pfg-navy">{fmt(cert.contractedValue)}</td>
                      <td className="px-4 py-3 text-right" style={{ color: cert.variationsClaimed ? "var(--amber)" : "var(--pfg-steel)" }}>
                        {fmt(cert.variationsClaimed)}
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--pfg-steel)" }}>{fmtDate(cert.createdAt)}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${cert.id}-detail`}>
                        <td colSpan={7} className="px-4 pb-4">
                          <CertificateDetail cert={cert} />
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

      {/* Modal */}
      {showModal && (
        <GenerateModal
          project={project}
          certificates={certificates}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
