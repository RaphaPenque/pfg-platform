/**
 * MilestoneApprovalPage — public, no-auth, standalone page
 * Route: /#/milestone-approval/:token
 *
 * Shown to customer approvers when they receive a milestone certificate email.
 * Allows them to approve or reject the certificate.
 */

import { useState, useEffect } from "react";
import { Award, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────

interface CertificateApprovalData {
  id: number;
  milestoneNumber: string;
  projectName: string;
  projectCode: string;
  workPackageName: string | null;
  status: string;
  contractedValue: number | null;
  variationsClaimed: number | null;
  totalValue: number | null;
  comments: string | null;
  scopeMechanicalCompletion: boolean;
  scopeInspectionQa: boolean;
  scopeTesting: boolean;
  scopeDocumentationSubmitted: boolean;
  scopeMinorSnaggingClosed: boolean;
  approverName: string | null;
  approverEmail: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
}

// ─── Scope items ──────────────────────────────────────────────────────

const SCOPE_ITEMS = [
  { key: "scopeMechanicalCompletion", label: "Mechanical Completion" },
  { key: "scopeInspectionQa", label: "Inspection / QA" },
  { key: "scopeTesting", label: "Testing" },
  { key: "scopeDocumentationSubmitted", label: "Documentation Submitted" },
  { key: "scopeMinorSnaggingClosed", label: "Minor Snagging Closed" },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Main Page ────────────────────────────────────────────────────────

export default function MilestoneApprovalPage({ params }: { params: { token: string } }) {
  const { token } = params;

  const [cert, setCert] = useState<CertificateApprovalData | null>(null);
  const [loadingState, setLoadingState] = useState<"loading" | "loaded" | "error" | "not_found">("loading");
  const [loadError, setLoadError] = useState<string>("");

  const [actionState, setActionState] = useState<"idle" | "approving" | "rejecting" | "done_approved" | "done_rejected" | "error">("idle");
  const [actionError, setActionError] = useState<string>("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [finalData, setFinalData] = useState<CertificateApprovalData | null>(null);

  // Load certificate data
  useEffect(() => {
    if (!token) { setLoadingState("not_found"); return; }
    setLoadingState("loading");
    fetch(`/api/milestone-approval/${token}`)
      .then(async (res) => {
        if (res.status === 404) { setLoadingState("not_found"); return; }
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        const data = await res.json();
        setCert(data);
        setLoadingState("loaded");
        // If already decided, show the done state immediately
        if (data.status === "approved") setActionState("done_approved");
        if (data.status === "rejected") setActionState("done_rejected");
      })
      .catch((e) => {
        setLoadError(e.message || "Failed to load certificate");
        setLoadingState("error");
      });
  }, [token]);

  const handleApprove = async () => {
    setActionState("approving");
    try {
      const res = await fetch(`/api/milestone-approval/${token}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = await res.json();
      setFinalData(data);
      setActionState("done_approved");
    } catch (e: any) {
      setActionError(e.message || "Failed to approve");
      setActionState("error");
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) return;
    setActionState("rejecting");
    try {
      const res = await fetch(`/api/milestone-approval/${token}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectionReason }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = await res.json();
      setFinalData(data);
      setActionState("done_rejected");
    } catch (e: any) {
      setActionError(e.message || "Failed to reject");
      setActionState("error");
    }
  };

  const displayCert = finalData || cert;
  const totalValue = (displayCert?.contractedValue || 0) + (displayCert?.variationsClaimed || 0);

  // ── Loading state ──
  if (loadingState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f1f5f9" }}>
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: "#1A1D23" }} />
          <p style={{ color: "#64748B", fontSize: "14px" }}>Loading certificate...</p>
        </div>
      </div>
    );
  }

  // ── Error states ──
  if (loadingState === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f1f5f9" }}>
        <div className="text-center max-w-sm mx-auto px-6">
          <AlertTriangle className="w-10 h-10 mx-auto mb-4" style={{ color: "#ef4444" }} />
          <h2 className="text-lg font-bold mb-2" style={{ color: "#1A1D23", fontFamily: "system-ui, sans-serif" }}>Certificate Not Found</h2>
          <p style={{ color: "#64748B", fontSize: "13px" }}>
            This approval link is invalid or has expired. Please contact your PowerForce Global project manager.
          </p>
        </div>
      </div>
    );
  }

  if (loadingState === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f1f5f9" }}>
        <div className="text-center max-w-sm mx-auto px-6">
          <AlertTriangle className="w-10 h-10 mx-auto mb-4" style={{ color: "#ef4444" }} />
          <h2 className="text-lg font-bold mb-2" style={{ color: "#1A1D23" }}>Error Loading Certificate</h2>
          <p style={{ color: "#64748B", fontSize: "13px" }}>{loadError}</p>
        </div>
      </div>
    );
  }

  // ── Main render ──
  return (
    <div className="min-h-screen" style={{ background: "#f1f5f9", fontFamily: "system-ui, -apple-system, sans-serif" }}>

      {/* PFG Branding Header */}
      <header style={{ background: "#1A1D23", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "0 24px", height: "64px", display: "flex", alignItems: "center", gap: "12px" }}>
          <Award style={{ width: "24px", height: "24px", color: "#F5C842" }} />
          <div>
            <div style={{ color: "#F5C842", fontWeight: 700, fontSize: "14px", letterSpacing: "0.03em" }}>
              PowerForce Global
            </div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Milestone Completion Certificate
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 24px" }}>

        {/* Project + milestone badge */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span style={{
              background: "#1A1D23",
              color: "#fff",
              fontSize: "11px",
              fontWeight: 700,
              padding: "2px 10px",
              borderRadius: "9999px",
              letterSpacing: "0.05em"
            }}>
              {displayCert?.projectCode}
            </span>
            <span style={{
              background: "#F5C842",
              color: "#1A1D23",
              fontSize: "11px",
              fontWeight: 800,
              padding: "2px 10px",
              borderRadius: "9999px",
              letterSpacing: "0.05em"
            }}>
              {displayCert?.milestoneNumber}
            </span>
          </div>
          <h1 style={{ color: "#1A1D23", fontSize: "22px", fontWeight: 800, margin: "0 0 4px" }}>
            {displayCert?.projectName}
          </h1>
          {displayCert?.workPackageName && (
            <p style={{ color: "#64748B", fontSize: "14px", margin: 0 }}>
              Work Package: <strong style={{ color: "#1A1D23" }}>{displayCert.workPackageName}</strong>
            </p>
          )}
        </div>

        {/* ── Done: Approved ── */}
        {actionState === "done_approved" && (
          <div style={{ background: "rgba(22,163,74,0.1)", border: "2px solid rgba(22,163,74,0.3)", borderRadius: "12px", padding: "24px", marginBottom: "24px", textAlign: "center" }}>
            <CheckCircle2 style={{ width: "40px", height: "40px", color: "#16a34a", margin: "0 auto 12px" }} />
            <h2 style={{ color: "#16a34a", fontWeight: 800, fontSize: "18px", marginBottom: "8px" }}>Certificate Approved</h2>
            <p style={{ color: "#16a34a", fontSize: "13px", marginBottom: "12px" }}>
              Thank you. This milestone certificate has been approved and countersigned.
            </p>
            {(finalData?.approverName || cert?.approverName) && (
              <div style={{ fontSize: "12px", color: "#15803d" }}>
                <div>Approved by: <strong>{finalData?.approverName || cert?.approverName}</strong></div>
                {(finalData?.approvedAt || cert?.approvedAt) && (
                  <div>Date: {fmtDate(finalData?.approvedAt || cert?.approvedAt)}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Done: Rejected ── */}
        {actionState === "done_rejected" && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "2px solid rgba(239,68,68,0.3)", borderRadius: "12px", padding: "24px", marginBottom: "24px", textAlign: "center" }}>
            <XCircle style={{ width: "40px", height: "40px", color: "#ef4444", margin: "0 auto 12px" }} />
            <h2 style={{ color: "#ef4444", fontWeight: 800, fontSize: "18px", marginBottom: "8px" }}>Certificate Rejected</h2>
            <p style={{ color: "#ef4444", fontSize: "13px" }}>
              This milestone certificate has been rejected.
              {(finalData?.rejectionReason || cert?.rejectionReason) && (
                <> Reason: <em>{finalData?.rejectionReason || cert?.rejectionReason}</em></>
              )}
            </p>
          </div>
        )}

        {/* ── Error ── */}
        {actionState === "error" && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px" }}>
            <p style={{ color: "#ef4444", fontSize: "12px", margin: 0 }}>{actionError}</p>
          </div>
        )}

        {/* Certificate details card */}
        <div style={{ background: "#fff", borderRadius: "12px", border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: "24px" }}>

          {/* Financial summary */}
          <div style={{ borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", background: "#e2e8f0" }}>
              {[
                { label: "Contracted Value", value: fmt(displayCert?.contractedValue) },
                { label: "Variations Claimed", value: fmt(displayCert?.variationsClaimed) },
                { label: "Total Value", value: fmt(totalValue), highlight: true },
              ].map(({ label, value, highlight }) => (
                <div key={label} style={{ background: "#fff", padding: "16px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748B", marginBottom: "6px" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: highlight ? "20px" : "16px", fontWeight: 800, color: highlight ? "#1A1D23" : "#334155" }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Scope completion */}
          <div style={{ padding: "20px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748B", marginBottom: "12px" }}>
              Scope Completion Checklist
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {SCOPE_ITEMS.map(({ key, label }) => {
                const checked = displayCert?.[key as keyof CertificateApprovalData] as boolean;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{
                      width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0,
                      background: checked ? "rgba(22,163,74,0.15)" : "#f1f5f9",
                      border: checked ? "none" : "1px solid #cbd5e1",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {checked && <CheckCircle2 style={{ width: "12px", height: "12px", color: "#16a34a" }} />}
                    </div>
                    <span style={{ fontSize: "13px", color: checked ? "#1A1D23" : "#64748B" }}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Comments */}
          {displayCert?.comments && (
            <div style={{ borderTop: "1px solid #e2e8f0", padding: "16px 20px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748B", marginBottom: "8px" }}>
                Comments / Exceptions
              </div>
              <p style={{ fontSize: "13px", color: "#334155", margin: 0, lineHeight: 1.6 }}>
                {displayCert.comments}
              </p>
            </div>
          )}
        </div>

        {/* Action buttons — only shown while idle or showing reject input */}
        {cert?.status === "sent" && actionState !== "done_approved" && actionState !== "done_rejected" && (
          <div style={{ background: "#fff", borderRadius: "12px", border: "1px solid #e2e8f0", padding: "24px" }}>
            <p style={{ color: "#334155", fontSize: "13px", marginTop: 0, marginBottom: "20px" }}>
              Please review the milestone certificate above and confirm your decision below.
              This action will be recorded and the project team notified.
            </p>

            {!showRejectInput ? (
              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  onClick={handleApprove}
                  disabled={actionState === "approving" || actionState === "rejecting"}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    padding: "14px 24px", borderRadius: "8px", border: "none",
                    background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: "14px",
                    cursor: actionState === "approving" ? "not-allowed" : "pointer",
                    opacity: actionState === "approving" ? 0.7 : 1,
                  }}
                >
                  {actionState === "approving"
                    ? <><Loader2 style={{ width: "16px", height: "16px", animation: "spin 1s linear infinite" }} /> Approving...</>
                    : <><CheckCircle2 style={{ width: "16px", height: "16px" }} /> Approve Certificate</>
                  }
                </button>
                <button
                  onClick={() => setShowRejectInput(true)}
                  disabled={actionState === "approving" || actionState === "rejecting"}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    padding: "14px 24px", borderRadius: "8px",
                    border: "2px solid #ef4444", background: "transparent",
                    color: "#ef4444", fontWeight: 700, fontSize: "14px", cursor: "pointer",
                  }}
                >
                  <XCircle style={{ width: "16px", height: "16px" }} /> Reject
                </button>
              </div>
            ) : (
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748B", marginBottom: "8px" }}>
                  Reason for Rejection (required)
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  placeholder="Describe the reason for rejection..."
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1",
                    fontSize: "13px", color: "#1A1D23", resize: "vertical", boxSizing: "border-box",
                    fontFamily: "inherit", marginBottom: "12px",
                  }}
                />
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    onClick={() => { setShowRejectInput(false); setRejectionReason(""); }}
                    style={{
                      padding: "10px 20px", borderRadius: "8px", border: "1px solid #cbd5e1",
                      background: "transparent", color: "#64748B", fontWeight: 600, fontSize: "13px", cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={!rejectionReason.trim() || actionState === "rejecting"}
                    style={{
                      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                      padding: "10px 20px", borderRadius: "8px", border: "none",
                      background: rejectionReason.trim() ? "#ef4444" : "#cbd5e1",
                      color: "#fff", fontWeight: 700, fontSize: "13px",
                      cursor: rejectionReason.trim() ? "pointer" : "not-allowed",
                    }}
                  >
                    {actionState === "rejecting"
                      ? <><Loader2 style={{ width: "14px", height: "14px" }} /> Submitting...</>
                      : <><XCircle style={{ width: "14px", height: "14px" }} /> Submit Rejection</>
                    }
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* If cert is already approved/rejected and we just loaded it (not just actioned) */}
        {cert?.status === "approved" && actionState === "done_approved" && !finalData && (
          <p style={{ textAlign: "center", color: "#64748B", fontSize: "12px" }}>
            This certificate was already approved on {fmtDate(cert.approvedAt)}.
          </p>
        )}
        {cert?.status === "rejected" && actionState === "done_rejected" && !finalData && (
          <p style={{ textAlign: "center", color: "#64748B", fontSize: "12px" }}>
            This certificate was previously rejected.
          </p>
        )}

        {/* Footer */}
        <p style={{ textAlign: "center", color: "#94a3b8", fontSize: "11px", marginTop: "32px" }}>
          PowerForce Global &middot; Milestone Completion Certificate &middot; Secure approval link
        </p>
      </div>

      {/* Spinner keyframes */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
