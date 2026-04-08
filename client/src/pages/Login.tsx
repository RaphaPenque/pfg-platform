import { useState } from "react";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/request-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send magic link");
        return;
      }
      setSent(true);
      if (data.devLink) {
        setDevToken(data.devLink);
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--pfg-navy, #1A1D23)" }}
    >
      <div className="w-[420px] max-w-[90vw]">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <img src="./logo-gold.png" alt="Powerforce Global" className="h-12 mx-auto mb-4" />
          <h1 className="text-white text-lg font-display font-bold tracking-wide">
            Workforce Intelligence Platform
          </h1>
          <p className="text-white/50 text-xs mt-1.5 tracking-wider uppercase">Sign in to continue</p>
        </div>

        {/* Card */}
        <div
          className="rounded-xl p-6"
          style={{ background: "hsl(var(--card))", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
        >
          {sent ? (
            <div className="text-center py-4" data-testid="magic-link-sent">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--green, #16a34a)" }} />
              <h2 className="font-display font-bold text-pfg-navy text-lg mb-2">Check your email</h2>
              <p className="text-sm" style={{ color: "var(--pfg-steel)" }}>
                We've sent a login link to <strong>{email}</strong>.
                <br />Click the link to sign in.
              </p>
              {devToken && (
                <div className="mt-4 p-3 rounded-lg text-[12px]" style={{ background: "hsl(var(--muted))" }}>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--pfg-steel)" }}>Dev Mode — Magic Link</div>
                  <a
                    href={`${API_BASE}/api/auth/verify?token=${devToken}`}
                    className="font-mono text-[11px] underline break-all"
                    style={{ color: "var(--pfg-yellow, #F5BD00)" }}
                    data-testid="dev-magic-link"
                  >
                    Click here to sign in
                  </a>
                </div>
              )}
              <button
                onClick={() => { setSent(false); setError(null); setDevToken(null); }}
                className="mt-4 text-xs font-semibold underline"
                style={{ color: "var(--pfg-steel)" }}
                data-testid="try-different-email"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--pfg-steel)" }}>
                Email Address
              </label>
              <div className="relative mb-4">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "hsl(var(--muted-foreground))" }} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@powerforce.global"
                  className="w-full pl-10 pr-4 py-3 text-[14px] rounded-lg border focus:outline-none focus:border-[var(--pfg-yellow)] focus:shadow-[0_0_0_3px_rgba(245,189,0,0.15)]"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
                  autoFocus
                  data-testid="login-email"
                />
              </div>

              {error && (
                <div className="mb-3 text-sm font-medium px-3 py-2 rounded-lg" style={{ background: "var(--red-bg)", color: "var(--red)" }} data-testid="login-error">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={sending || !email.trim()}
                className="w-full py-3 text-[14px] font-semibold rounded-lg flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "var(--pfg-yellow, #F5BD00)", color: "var(--pfg-navy, #1A1D23)" }}
                data-testid="send-magic-link"
              >
                {sending && <Loader2 className="w-4 h-4 animate-spin" />}
                {sending ? "Sending..." : "Send Magic Link"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-white/30 text-[10px] mt-6">
          &copy; 2026 PowerForce Global
        </p>
      </div>
    </div>
  );
}
