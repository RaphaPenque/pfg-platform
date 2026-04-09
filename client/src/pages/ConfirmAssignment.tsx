import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

interface ConfirmData {
  assignment: {
    id: number;
    role: string | null;
    shift: string | null;
    startDate: string | null;
    endDate: string | null;
    status: string | null;
    confirmedAt: string | null;
    declinedAt: string | null;
  };
  worker: { id: number; name: string } | null;
  project: { id: number; name: string; location: string | null; siteName: string | null } | null;
  roleSlot: { id: number; role: string; shift: string | null } | null;
  status: string | null;
  alreadyResponded: boolean;
}

export default function ConfirmAssignment({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<ConfirmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [responded, setResponded] = useState<"confirmed" | "declined" | null>(null);

  useEffect(() => {
    fetch(`/api/confirm/${token}`)
      .then(r => {
        if (!r.ok) throw new Error("invalid");
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("invalid"); setLoading(false); });
  }, [token]);

  async function handleResponse(action: "accept" | "decline") {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/confirm/${token}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      setResponded(action === "accept" ? "confirmed" : "declined");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  }

  // Already responded from loaded data
  const alreadyConfirmed = data?.assignment?.confirmedAt || responded === "confirmed";
  const alreadyDeclined = data?.assignment?.declinedAt || responded === "declined";

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f5", fontFamily: "'Inter', Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#1A1D23", padding: "20px 0", textAlign: "center" }}>
        <img src="https://pfg-platform.onrender.com/logo-gold.png" alt="Powerforce Global" style={{ height: 36 }} />
      </div>

      <div style={{ maxWidth: 560, margin: "32px auto", padding: "0 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "64px 0" }}>
            <Loader2 style={{ width: 32, height: 32, margin: "0 auto 12px", color: "#F5BD00", animation: "spin 1s linear infinite" }} />
            <p style={{ color: "#6b7280", fontSize: 14 }}>Loading assignment details...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error === "invalid" ? (
          <div style={{ background: "#fff", borderRadius: 12, padding: "48px 32px", textAlign: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
            <AlertTriangle style={{ width: 48, height: 48, color: "#9ca3af", margin: "0 auto 16px" }} />
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1A1D23", margin: "0 0 8px" }}>This link is no longer valid</h2>
            <p style={{ color: "#6b7280", fontSize: 14 }}>The confirmation link may have expired or already been used.</p>
          </div>
        ) : data ? (
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
            {/* Worker + Project header */}
            <div style={{ padding: "28px 32px", borderBottom: "1px solid #f0f0f0" }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1A1D23", margin: "0 0 4px" }}>
                Assignment Confirmation
              </h1>
              <p style={{ fontSize: 15, color: "#4b5563", margin: 0 }}>
                {data.worker?.name} &mdash; {data.project?.name}
              </p>
            </div>

            {/* Details table */}
            <div style={{ padding: "24px 32px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  <DetailRow label="Role" value={data.assignment.role || "—"} />
                  <DetailRow label="Shift" value={data.assignment.shift || "—"} />
                  <DetailRow label="Start Date" value={data.assignment.startDate || "—"} />
                  <DetailRow label="End Date" value={data.assignment.endDate || "—"} />
                  <DetailRow label="Location" value={data.project?.location || data.project?.siteName || "—"} last />
                </tbody>
              </table>
            </div>

            {/* Action area */}
            <div style={{ padding: "24px 32px 32px", textAlign: "center" }}>
              {alreadyConfirmed ? (
                <div style={{ background: "#f0fdf4", borderRadius: 12, padding: "24px" }}>
                  <CheckCircle2 style={{ width: 40, height: 40, color: "#16a34a", margin: "0 auto 12px" }} />
                  <p style={{ fontSize: 16, fontWeight: 600, color: "#16a34a", margin: "0 0 4px" }}>Assignment Confirmed</p>
                  <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
                    You confirmed this assignment{data.assignment.confirmedAt ? ` on ${new Date(data.assignment.confirmedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}.
                  </p>
                </div>
              ) : alreadyDeclined ? (
                <div style={{ background: "#fef2f2", borderRadius: 12, padding: "24px" }}>
                  <XCircle style={{ width: 40, height: 40, color: "#dc2626", margin: "0 auto 12px" }} />
                  <p style={{ fontSize: 16, fontWeight: 600, color: "#dc2626", margin: "0 0 4px" }}>Assignment Declined</p>
                  <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
                    You declined this assignment{data.assignment.declinedAt ? ` on ${new Date(data.assignment.declinedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => handleResponse("accept")}
                    disabled={submitting}
                    style={{
                      background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 15,
                      padding: "14px 32px", borderRadius: 8, border: "none", cursor: submitting ? "wait" : "pointer",
                      opacity: submitting ? 0.6 : 1,
                    }}
                  >
                    {submitting ? "..." : "\u2713 Confirm Assignment"}
                  </button>
                  <button
                    onClick={() => handleResponse("decline")}
                    disabled={submitting}
                    style={{
                      background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 15,
                      padding: "14px 32px", borderRadius: 8, border: "none", cursor: submitting ? "wait" : "pointer",
                      opacity: submitting ? 0.6 : 1,
                    }}
                  >
                    {submitting ? "..." : "\u2717 Decline Assignment"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <p style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", marginTop: 24 }}>
          &copy; {new Date().getFullYear()} Powerforce Global &middot; Confidential
        </p>
      </div>
    </div>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <tr>
      <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b7280", borderBottom: last ? "none" : "1px solid #f0f0f0", width: "120px" }}>{label}</td>
      <td style={{ padding: "10px 12px", fontSize: 14, fontWeight: 600, color: "#1A1D23", borderBottom: last ? "none" : "1px solid #f0f0f0" }}>{value}</td>
    </tr>
  );
}
