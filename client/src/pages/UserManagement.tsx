import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, UserX, UserCheck, RefreshCw, X, Search, ShieldCheck, Briefcase, Eye, Calculator, Shield } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────
type UserRole = "admin" | "resource_manager" | "project_manager" | "finance" | "observer";

interface PlatformUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
}

// ─── Role config ──────────────────────────────────────────────────
const ROLES: { value: UserRole; label: string; description: string; icon: React.ReactNode; color: string }[] = [
  {
    value: "admin",
    label: "Admin",
    description: "Full platform access — users, payroll rules, all projects",
    icon: <Shield className="w-3.5 h-3.5" />,
    color: "#f5bd00",
  },
  {
    value: "resource_manager",
    label: "Resource Manager",
    description: "Manage workforce, assign workers, access all projects",
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    color: "#3b82f6",
  },
  {
    value: "project_manager",
    label: "Project Manager",
    description: "View and manage assigned projects and team",
    icon: <Briefcase className="w-3.5 h-3.5" />,
    color: "#10b981",
  },
  {
    value: "finance",
    label: "Finance",
    description: "Access to payroll rules and cost data",
    icon: <Calculator className="w-3.5 h-3.5" />,
    color: "#8b5cf6",
  },
  {
    value: "observer",
    label: "Observer",
    description: "Read-only access to projects and workforce",
    icon: <Eye className="w-3.5 h-3.5" />,
    color: "#6b7280",
  },
];

function roleMeta(role: UserRole) {
  return ROLES.find(r => r.value === role) || ROLES[4];
}

function RoleBadge({ role }: { role: UserRole }) {
  const meta = roleMeta(role);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: meta.color + "22", color: meta.color }}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 30) return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "Just now";
}

// ─── Create / Edit Modal ──────────────────────────────────────────
interface UserModalProps {
  user?: PlatformUser;
  onClose: () => void;
}

function UserModal({ user, onClose }: UserModalProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!user;

  const [form, setForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    role: (user?.role || "project_manager") as UserRole,
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast({ title: "Name and email are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await apiRequest("PATCH", `/api/users/${user!.id}`, { name: form.name, role: form.role });
        toast({ title: `${form.name} updated` });
      } else {
        const res = await apiRequest("POST", "/api/users", { name: form.name, email: form.email, role: form.role });
        const data = await res.json();
        toast({
          title: `${form.name} invited`,
          description: "A welcome email with their login link has been sent.",
        });
      }
      await qc.invalidateQueries({ queryKey: ["/api/users"] });
      onClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full rounded-lg border text-[13px] px-3 py-2 outline-none focus:ring-2 focus:ring-pfg-navy/30 bg-white";
  const labelCls = "block text-[11px] font-semibold uppercase tracking-wide mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-[15px] font-bold text-pfg-navy font-display">
              {isEdit ? "Edit User" : "Invite New User"}
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>
              {isEdit ? "Update name or role" : "A welcome email with a login link will be sent automatically"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X className="w-4 h-4" style={{ color: "var(--pfg-steel)" }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Full Name</label>
            <input
              className={inputCls}
              placeholder="e.g. Jane Smith"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
              style={{ borderColor: "hsl(var(--border))" }}
            />
          </div>

          {!isEdit && (
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Email Address</label>
              <input
                type="email"
                className={inputCls}
                placeholder="e.g. jane@powerforce.global"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
                style={{ borderColor: "hsl(var(--border))" }}
              />
            </div>
          )}

          <div>
            <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Role</label>
            <div className="space-y-2">
              {ROLES.map(r => (
                <label
                  key={r.value}
                  className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition"
                  style={{
                    borderColor: form.role === r.value ? r.color : "hsl(var(--border))",
                    background: form.role === r.value ? r.color + "0d" : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    checked={form.role === r.value}
                    onChange={() => setForm(f => ({ ...f, role: r.value }))}
                    className="mt-0.5 shrink-0"
                  />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span style={{ color: r.color }}>{r.icon}</span>
                      <span className="text-[13px] font-semibold text-pfg-navy">{r.label}</span>
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>{r.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </form>

        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-medium border hover:bg-gray-100 transition"
            style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit as any}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-[13px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: "var(--pfg-navy)" }}
          >
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Send Invite"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Resend Link Modal ────────────────────────────────────────────
function ResendConfirm({ user, onClose }: { user: PlatformUser; onClose: () => void }) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    try {
      await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      toast({ title: `Login link sent to ${user.email}` });
      onClose();
    } catch {
      toast({ title: "Failed to send link", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-[15px] font-bold text-pfg-navy font-display mb-1">Resend Login Link</h3>
        <p className="text-[13px] mb-4" style={{ color: "var(--pfg-steel)" }}>
          Send a new magic link to <strong>{user.email}</strong>? It will expire in 15 minutes.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border text-[13px] font-medium hover:bg-gray-50 transition" style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}>
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="flex-1 py-2 rounded-lg text-[13px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: "var(--pfg-navy)" }}
          >
            {sending ? "Sending…" : "Send Link"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────
export default function UserManagement() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [modal, setModal] = useState<"create" | "edit" | "resend" | null>(null);
  const [selected, setSelected] = useState<PlatformUser | null>(null);

  const { data: users = [], isLoading } = useQuery<PlatformUser[]>({
    queryKey: ["/api/users"],
    queryFn: () => apiRequest("GET", "/api/users").then(r => r.json()),
  });

  const toggleActive = useMutation({
    mutationFn: (u: PlatformUser) =>
      apiRequest("PATCH", `/api/users/${u.id}`, { isActive: !u.isActive }).then(r => r.json()),
    onSuccess: (_, u) => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: u.isActive ? `${u.name} deactivated` : `${u.name} reactivated` });
    },
  });

  const filtered = users.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const active = filtered.filter(u => u.isActive);
  const inactive = filtered.filter(u => !u.isActive);

  return (
    <div className="space-y-6">
      {/* Modals */}
      {modal === "create" && <UserModal onClose={() => setModal(null)} />}
      {modal === "edit" && selected && <UserModal user={selected} onClose={() => { setModal(null); setSelected(null); }} />}
      {modal === "resend" && selected && <ResendConfirm user={selected} onClose={() => { setModal(null); setSelected(null); }} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-pfg-navy font-display">User Management</h1>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>
            {users.filter(u => u.isActive).length} active · {users.filter(u => !u.isActive).length} inactive
          </p>
        </div>
        <button
          onClick={() => setModal("create")}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition hover:opacity-90"
          style={{ background: "var(--pfg-navy)" }}
          data-testid="button-invite-user"
        >
          <Plus className="w-4 h-4" />
          Invite User
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--pfg-steel)" }} />
          <input
            className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border outline-none focus:ring-2 focus:ring-pfg-navy/20 bg-white"
            style={{ borderColor: "hsl(var(--border))" }}
            placeholder="Search name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5">
          {([{ value: "all", label: "All" }, ...ROLES.map(r => ({ value: r.value, label: r.label }))] as const).map((r: any) => (
            <button
              key={r.value}
              onClick={() => setRoleFilter(r.value)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition"
              style={roleFilter === r.value
                ? { background: "var(--pfg-navy)", color: "#fff" }
                : { background: "hsl(var(--muted))", color: "var(--pfg-steel)" }
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-xl" style={{ background: "hsl(var(--muted))" }} />)}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Users */}
          {active.length > 0 && (
            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-wide mb-2 flex items-center gap-2" style={{ color: "var(--pfg-steel)" }}>
                <div className="w-2 h-2 rounded-full" style={{ background: "var(--green)" }} />
                Active ({active.length})
              </h2>
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ background: "hsl(var(--muted))" }}>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Name</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Email</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Role</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Last Login</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((u, i) => (
                      <tr
                        key={u.id}
                        className="border-t transition hover:bg-gray-50"
                        style={{ borderColor: "hsl(var(--border))" }}
                      >
                        <td className="px-4 py-3 font-medium text-pfg-navy">{u.name}</td>
                        <td className="px-4 py-3" style={{ color: "var(--pfg-steel)" }}>{u.email}</td>
                        <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                        <td className="px-4 py-3 text-[12px]" style={{ color: "var(--pfg-steel)" }}>
                          {u.lastLoginAt ? timeAgo(u.lastLoginAt) : (
                            <span className="italic" style={{ color: "#f59e0b" }}>Never logged in</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              title="Resend login link"
                              onClick={() => { setSelected(u); setModal("resend"); }}
                              className="p-1.5 rounded-lg hover:bg-gray-100 transition"
                              style={{ color: "var(--pfg-steel)" }}
                              data-testid={`button-resend-${u.id}`}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              title="Edit user"
                              onClick={() => { setSelected(u); setModal("edit"); }}
                              className="p-1.5 rounded-lg hover:bg-gray-100 transition"
                              style={{ color: "var(--pfg-steel)" }}
                              data-testid={`button-edit-${u.id}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              title="Deactivate"
                              onClick={() => toggleActive.mutate(u)}
                              className="p-1.5 rounded-lg hover:bg-red-50 transition"
                              style={{ color: "var(--red)" }}
                              data-testid={`button-deactivate-${u.id}`}
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Inactive Users */}
          {inactive.length > 0 && (
            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-wide mb-2 flex items-center gap-2" style={{ color: "var(--pfg-steel)" }}>
                <div className="w-2 h-2 rounded-full bg-gray-400" />
                Inactive ({inactive.length})
              </h2>
              <div className="rounded-xl border overflow-hidden opacity-60" style={{ borderColor: "hsl(var(--border))" }}>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ background: "hsl(var(--muted))" }}>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Name</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Email</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Role</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {inactive.map(u => (
                      <tr key={u.id} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                        <td className="px-4 py-3 font-medium" style={{ color: "var(--pfg-steel)" }}>{u.name}</td>
                        <td className="px-4 py-3" style={{ color: "var(--pfg-steel)" }}>{u.email}</td>
                        <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              title="Reactivate"
                              onClick={() => toggleActive.mutate(u)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition hover:opacity-80"
                              style={{ background: "var(--green-bg)", color: "var(--green)" }}
                              data-testid={`button-reactivate-${u.id}`}
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              Reactivate
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {filtered.length === 0 && (
            <div className="text-center py-16">
              <p className="text-[13px]" style={{ color: "var(--pfg-steel)" }}>No users match your search.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
