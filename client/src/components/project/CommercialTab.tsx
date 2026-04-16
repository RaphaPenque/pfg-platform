import { useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DashboardProject, DashboardWorker, DashboardAssignment } from "@/hooks/use-dashboard-data";
import InlineField from "@/components/project/InlineField";
import MilestoneCertificateTab from "@/components/project/MilestoneCertificateTab";
import { DollarSign, FileText, Award } from "lucide-react";

// ─── Contract type badge ──────────────────────────────────────────────

const CONTRACT_COLORS: Record<string, { bg: string; color: string }> = {
  "T&M": { bg: "var(--amber-bg)", color: "var(--amber)" },
  "SOW": { bg: "rgba(59,130,246,0.1)", color: "#3b82f6" },
};

function ContractTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span style={{ color: "var(--pfg-steel)" }}>—</span>;
  const s = CONTRACT_COLORS[type] || { bg: "hsl(var(--muted))", color: "var(--pfg-steel)" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide"
      style={{ background: s.bg, color: s.color }}
    >
      {type}
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────────

interface CommercialTabProps {
  project: DashboardProject;
  user: any;
  workers: DashboardWorker[];
  assignments: DashboardAssignment[];
}

export default function CommercialTab({ project, user, workers, assignments }: CommercialTabProps) {
  const { toast } = useToast();
  const canEdit = user?.role === "admin" || user?.role === "resource_manager";

  const savePO = useCallback(async (value: string) => {
    try {
      await apiRequest("PATCH", `/api/projects/${project.id}`, { poNumber: value || null });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    } catch (e: any) {
      toast({ title: "Error saving PO Number", description: e.message || "Unknown error", variant: "destructive" });
    }
  }, [project.id, toast]);

  return (
    <div className="space-y-6">

      {/* ── Section 1: Milestone Certificates ─────────────────────── */}
      <div className="rounded-xl border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <div
          className="flex items-center gap-2 px-5 py-4 border-b"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <Award className="w-4 h-4" style={{ color: "var(--pfg-yellow-dark)" }} />
          <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>
            Milestone Certificates
          </h2>
        </div>
        <div className="p-5">
          <MilestoneCertificateTab
            project={project}
            user={user}
            workers={workers}
            assignments={assignments}
          />
        </div>
      </div>

      {/* ── Section 2: Financial Overview ─────────────────────────── */}
      <div className="rounded-xl border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <div
          className="flex items-center gap-2 px-5 py-4 border-b"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <DollarSign className="w-4 h-4" style={{ color: "var(--pfg-yellow-dark)" }} />
          <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>
            Financial Overview
          </h2>
        </div>
        <div className="p-5 space-y-4">

          {/* Contract summary row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--pfg-steel)" }}>
                Contract Type
              </div>
              <ContractTypeBadge type={project.contractType} />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--pfg-steel)" }}>
                PO Number
              </div>
              <InlineField
                value={(project as any).poNumber ?? null}
                onSave={savePO}
                canEdit={canEdit}
                placeholder="e.g. PO-2026-001"
                emptyLabel="Not set"
              />
            </div>
          </div>

          {/* Invoice workflow stub */}
          <div
            className="rounded-lg border-2 border-dashed p-6 flex flex-col items-center justify-center text-center"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <FileText className="w-8 h-8 mb-3 opacity-30" style={{ color: "var(--pfg-navy)" }} />
            <p className="text-[13px] font-semibold text-pfg-navy mb-1">Invoice Workflow</p>
            <p className="text-[12px]" style={{ color: "var(--pfg-steel)" }}>
              Coming in Phase 7 — automated invoice generation and approval tracking.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
