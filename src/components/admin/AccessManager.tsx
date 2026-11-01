import { useEffect, useMemo, useState } from "react";
import { useConfirm } from "./useConfirm";
import {
  AlertTriangle,
  Check,
  CircleUserRound,
  Eye,
  EyeOff,
  KeyRound,
  Minus,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/admin/filter-bar";
import { FilterSelect } from "@/components/admin/filter-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdminRole } from "../../lib/auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const ROLE_FILTER_LABELS: Record<string, string> = {
  all: "Semua Role",
  owner: "Owner",
  admin: "Admin Ops",
  advertiser: "Operator Ads",
  customer_service: "Operator CS",
};
const ASSIGNABLE_ROLE_OPTIONS: Record<string, string> = {
  admin: "Admin Ops (Akses Seluruh Operasional)",
  advertiser: "Operator Ads (Produk, Content & Ads Signal)",
  customer_service: "Operator CS (Order, Pengiriman & WA)",
};
const ASSIGNABLE_ROLE_SHORT_LABELS: Record<string, string> = {
  admin: "Admin Ops",
  advertiser: "Operator Ads",
  customer_service: "Operator CS",
};
const ROLE_EDIT_OPTIONS = Object.entries(ASSIGNABLE_ROLE_SHORT_LABELS).map(([value, label]) => ({
  value: value as AssignableRole,
  label,
}));


type AssignableRole = Exclude<AdminRole, "owner">;

type AccessUser = {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  role: AdminRole;
  must_change_password: number | boolean;
  updated_at: string;
};


const ROLE_SHORT_LABELS: Record<AdminRole, string> = {
  owner: "Owner",
  admin: "Admin",
  advertiser: "Operator Ads",
  customer_service: "Operator CS",
};

const ROLE_DESCRIPTIONS: Record<AssignableRole, string> = {
  admin:
    "Akses penuh ke semua operasional toko, produk, pengiriman, dan integrasi payment, kecuali manajemen Akses Pengguna.",
  advertiser:
    "Akses khusus pemasaran: Dashboard analytics, Katalog Produk, Form Storefront, dan Signals OS (Meta/Google Ads).",
  customer_service:
    "Akses khusus pelayanan: Dashboard penjualan, Pesanan, Pengiriman kurir, Cek Risiko No. WA & Cek Ongkir.",
};

const ROLE_BADGE_STYLES: Record<
  AdminRole,
  { badge: string; dot: string; text: string }
> = {
  owner: {
    badge: "bg-emerald-50 text-emerald-900 border-emerald-200/80",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
  },
  admin: {
    badge: "bg-blue-50 text-blue-900 border-blue-200/80",
    dot: "bg-blue-500",
    text: "text-blue-700",
  },
  advertiser: {
    badge: "bg-purple-50 text-purple-900 border-purple-200/80",
    dot: "bg-purple-500",
    text: "text-purple-700",
  },
  customer_service: {
    badge: "bg-amber-50 text-amber-900 border-amber-200/80",
    dot: "bg-amber-500",
    text: "text-amber-700",
  },
};

const PERMISSION_COLUMNS: ReadonlyArray<{ role: AdminRole; label: string }> = [
  { role: "owner", label: "Owner" },
  { role: "admin", label: "Admin" },
  { role: "advertiser", label: "Operator Ads" },
  { role: "customer_service", label: "Operator CS" },
];

type AccessLevel = "full" | "limited" | "none";

const PERMISSION_ROWS: ReadonlyArray<{
  capability: string;
  description: string;
  access: Record<AdminRole, AccessLevel>;
}> = [
  {
    capability: "Dashboard & Metrik Ringkasan",
    description: "Melihat omset, grafik penjualan, dan performa pesanan.",
    access: {
      owner: "full",
      admin: "full",
      advertiser: "full",
      customer_service: "full",
    },
  },
  {
    capability: "Order & Operasional CS",
    description: "Kelola status pesanan, follow-up WhatsApp, dan jadwal kurir.",
    access: {
      owner: "full",
      admin: "full",
      advertiser: "none",
      customer_service: "full",
    },
  },
  {
    capability: "Katalog Produk & Content Storefront",
    description: "Tambah/edit produk, varian, media WebP, & landing page.",
    access: {
      owner: "full",
      admin: "full",
      advertiser: "full",
      customer_service: "none",
    },
  },
  {
    capability: "Ads Signal OS (Meta, Google)",
    description: "Konfigurasi Pixel, CAPI Token, dan audit conversion tracking.",
    access: {
      owner: "full",
      admin: "full",
      advertiser: "full",
      customer_service: "none",
    },
  },
  {
    capability: "Pengaturan Toko, Payment & Integrasi",
    description: "Setup bank transfer, AutoLaris VA/QRIS, Mengantar API & Webhooks.",
    access: {
      owner: "full",
      admin: "full",
      advertiser: "none",
      customer_service: "none",
    },
  },
  {
    capability: "Akses Pengguna & Hak Akses Role",
    description: "Tambah staff baru, reset password, dan cabut akun admin.",
    access: {
      owner: "full",
      admin: "none",
      advertiser: "none",
      customer_service: "none",
    },
  },
];

function generateRandomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const randomBytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(randomBytes, (byte) => chars[byte % chars.length]).join("");
}

export function AccessManager() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [showPassword, setShowPassword] = useState(false);

  // Edit User State Modal
  const [editingUser, setEditingUser] = useState<AccessUser | null>(null);
  const [editForm, setEditForm] = useState({
    display_name: "",
    email: "",
    role: "customer_service" as AssignableRole,
  });

  // Reset Password State Modal
  const [resetUser, setResetUser] = useState<AccessUser | null>(null);
  const [newPasswordValue, setNewPasswordValue] = useState("");

  // Create User Form State
  const [form, setForm] = useState({
    display_name: "",
    email: "",
    username: "",
    password: "",
    role: "customer_service" as AssignableRole,
  });

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/access", {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Daftar akses gagal dimuat.");
      }
      setUsers((payload.data?.users || []) as AccessUser[]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Daftar akses gagal dimuat.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchRole = roleFilter === "all" || user.role === roleFilter;
      const search = searchTerm.trim().toLowerCase();
      const matchSearch =
        !search ||
        user.username.toLowerCase().includes(search) ||
        (user.display_name && user.display_name.toLowerCase().includes(search)) ||
        (user.email && user.email.toLowerCase().includes(search));
      return matchRole && matchSearch;
    });
  }, [users, roleFilter, searchTerm]);

  const stats = useMemo(() => {
    return {
      total: users.length,
      owner: users.filter((u) => u.role === "owner").length,
      admin: users.filter((u) => u.role === "admin").length,
      advertiser: users.filter((u) => u.role === "advertiser").length,
      cs: users.filter((u) => u.role === "customer_service").length,
    };
  }, [users]);

  const create = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Pengguna gagal dibuat.");
      }
      setUsers((current) => [...current, payload.data as AccessUser]);
      setForm({
        display_name: "",
        email: "",
        username: "",
        password: "",
        role: "customer_service",
      });
      toast.success(payload.message || "Pengguna berhasil dibuat.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Pengguna gagal dibuat.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEdit = (user: AccessUser) => {
    setEditingUser(user);
    setEditForm({
      display_name: user.display_name || "",
      email: user.email || "",
      role: user.role === "owner" ? "admin" : (user.role as AssignableRole),
    });
  };

  const saveUserEdit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingUser) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingUser.id,
          display_name: editForm.display_name,
          email: editForm.email,
          role: editForm.role,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Gagal memperbarui pengguna.");
      }
      setUsers((current) =>
        current.map((u) => (u.id === editingUser.id ? (payload.data as AccessUser) : u)),
      );
      setEditingUser(null);
      toast.success(payload.message || "Profil & peran berhasil diperbarui.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal memperbarui pengguna.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleOpenReset = (user: AccessUser) => {
    setResetUser(user);
    setNewPasswordValue(generateRandomPassword());
  };

  const savePasswordReset = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetUser || !newPasswordValue) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: resetUser.id,
          password: newPasswordValue,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Gagal me-reset password.");
      }
      setUsers((current) =>
        current.map((u) => (u.id === resetUser.id ? (payload.data as AccessUser) : u)),
      );
      toast.success(payload.message || "Password berhasil di-reset!");
      setResetUser(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal me-reset password.",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (user: AccessUser) => {
    if (!(await confirm({ title: "Cabut akses akun?", description: `Akun "${user.username}" kehilangan seluruh hak akses dan sesinya berakhir.`, confirmLabel: "Cabut akses" }))) {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Akses gagal dicabut.");
      }
      setUsers((current) => current.filter((item) => item.id !== user.id));
      toast.success(payload.message || "Akses pengguna berhasil dicabut.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Akses pengguna gagal dicabut.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {confirmDialog}
      {/* Overview Stats Bar */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2 text-slate-500">
            <Users className="size-4 text-emerald-600" />
            <span className="text-xs font-semibold">Total Akun</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-4 shadow-xs">
          <div className="flex items-center gap-2 text-emerald-800">
            <ShieldCheck className="size-4 text-emerald-600" />
            <span className="text-xs font-semibold">Owner</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-emerald-950">{stats.owner}</p>
        </div>
        <div className="rounded-xl border border-blue-200/80 bg-blue-50/50 p-4 shadow-xs">
          <div className="flex items-center gap-2 text-blue-800">
            <CircleUserRound className="size-4 text-blue-600" />
            <span className="text-xs font-semibold">Admin Ops</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-blue-950">{stats.admin}</p>
        </div>
        <div className="rounded-xl border border-purple-200/80 bg-purple-50/50 p-4 shadow-xs">
          <div className="flex items-center gap-2 text-purple-800">
            <Sparkles className="size-4 text-purple-600" />
            <span className="text-xs font-semibold">Operator Ads</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-purple-950">{stats.advertiser}</p>
        </div>
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-4 col-span-2 sm:col-span-1 shadow-xs">
          <div className="flex items-center gap-2 text-amber-800">
            <UserCheck className="size-4 text-amber-600" />
            <span className="text-xs font-semibold">Operator CS</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-amber-950">{stats.cs}</p>
        </div>
      </section>

      {/* Main Grid: User List & Add Form */}
      <div className="grid grid-cols-1 min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Left Column: User Directory */}
        <Card className="min-w-0 rounded-xl border-slate-200 shadow-xs">
          <CardHeader className="border-b border-slate-100 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-slate-950">
                  Daftar Pengguna Sistem
                </CardTitle>
                <p className="mt-0.5 text-xs text-slate-500">
                  Kelola izin staf. Pengguna hanya dapat mengakses halaman sesuai perannya.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw
                  className={loading ? "animate-spin" : undefined}
                />
                Refresh
              </Button>
            </div>

            {/* Filter & Search Controls */}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput className="flex-1" placeholder="Cari username, nama, atau email" aria-label="Cari akun" value={searchTerm} onValueChange={setSearchTerm} />
              <div className="w-full sm:w-48">
                <FilterSelect
                  id="access-role-filter"
                  ariaLabel="Filter role"
                  icon={UserCog}
                  value={roleFilter}
                  onValueChange={setRoleFilter}
                  options={Object.entries(ROLE_FILTER_LABELS).map(([value, label]) => ({ value, label }))}
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4">
            {loading ? (
              <div className="space-y-3 p-2">
                <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-8 text-center">
                <ShieldAlert className="mx-auto size-8 text-slate-300" />
                <p className="mt-2 text-xs font-semibold text-slate-600">
                  Tidak ada pengguna yang cocok dengan kriteria pencarian.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-white">
                {filteredUsers.map((user) => {
                  const style = ROLE_BADGE_STYLES[user.role];
                  const initial = (user.display_name || user.username)
                    .charAt(0)
                    .toUpperCase();
                  const isOwner = user.role === "owner";

                  return (
                    <article
                      key={user.id}
                      className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50/60 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {/* Avatar */}
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 font-mono text-sm font-semibold text-white shadow-xs">
                          {initial}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold text-slate-950">
                              {user.display_name || user.username}
                            </p>

                            {/* Role Badge */}
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${style.badge}`}
                            >
                              <span
                                className={`size-1.5 shrink-0 rounded-full ${style.dot}`}
                                aria-hidden="true"
                              />
                              {ROLE_SHORT_LABELS[user.role]}
                            </span>

                            {/* Active Status */}
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200/60">
                              <span className="size-1.5 rounded-full bg-emerald-500" />
                              Aktif
                            </span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                            <span className="font-mono font-semibold text-slate-700">
                              @{user.username}
                            </span>
                            {user.email && (
                              <span className="truncate">{user.email}</span>
                            )}
                          </div>

                          {Boolean(user.must_change_password) && (
                            <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                              <AlertTriangle className="size-3.5 text-amber-600" />
                              Wajib ganti password pada login berikutnya.
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      {!isOwner && (
                        <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="Edit profil & role"
                            onClick={() => handleOpenEdit(user)}
                            className="px-2.5 text-slate-700 hover:bg-slate-200/60"
                          >
                            <Pencil className="mr-1 size-3.5 text-slate-500" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="Reset password sementara"
                            onClick={() => handleOpenReset(user)}
                            className="px-2.5 text-amber-700 hover:bg-amber-100/60 hover:text-amber-800"
                          >
                            <KeyRound className="mr-1 size-3.5" />
                            Reset
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="Cabut akses"
                            disabled={saving}
                            onClick={() => void remove(user)}
                            className="px-2.5 text-rose-700 hover:bg-rose-100/60 hover:text-rose-800"
                          >
                            <Trash2 className="mr-1 size-3.5" />
                            Hapus
                          </Button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Add User Form */}
        <Card className="min-w-0 rounded-xl border-slate-200 shadow-xs h-fit">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <UserPlus className="size-4 text-emerald-600" />
              Tambah Pengguna Baru
            </CardTitle>
            <p className="text-xs text-slate-500">
              Buat kredensial staf baru. Pengguna wajib mengganti password sementara saat login pertama.
            </p>
          </CardHeader>
          <CardContent className="p-4">
            <form onSubmit={create} className="space-y-4">
              <div>
                <label htmlFor="access-display-name" className="text-xs font-semibold text-slate-900">
                  Nama Lengkap <span className="text-rose-500">*</span>
                </label>
                <Input
                  id="access-display-name"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="Misal: Ahmad Fauzi"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-900">
                  Role & Peran Akses <span className="text-rose-500">*</span>
                </label>
                <Select
                  items={ASSIGNABLE_ROLE_OPTIONS}
                  value={form.role}
                  onValueChange={(value) =>
                    value && setForm({ ...form, role: value as AssignableRole })
                  }
                >
                  <SelectTrigger aria-label="Role" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ASSIGNABLE_ROLE_OPTIONS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1.5 rounded-lg bg-slate-50 p-2 text-xs leading-4 text-slate-600 border border-slate-100">
                  {ROLE_DESCRIPTIONS[form.role]}
                </p>
              </div>

              <div>
                <label htmlFor="access-username" className="text-xs font-semibold text-slate-900">
                  Username Login <span className="text-rose-500">*</span>
                </label>
                <Input
                  id="access-username"
                  required
                  minLength={3}
                  maxLength={64}
                  autoCapitalize="none"
                  placeholder="misal: ahmad_cs"
                  value={form.username}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value.toLowerCase() })
                  }
                  className="mt-1 font-mono"
                />
                <span className="text-xs text-slate-400">
                  3–64 karakter (huruf kecil, angka, titik, garis bawah, strip).
                </span>
              </div>

              <div>
                <label htmlFor="access-email" className="text-xs font-semibold text-slate-900">Email Opsional</label>
                <Input
                  id="access-email"
                  type="email"
                  maxLength={160}
                  placeholder="ahmad@perusahaan.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="mt-1"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="access-password" className="text-xs font-semibold text-slate-900">
                    Password Sementara <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, password: generateRandomPassword() })
                    }
                    className="text-xs font-semibold text-emerald-700 hover:underline"
                  >
                    Acak Password
                  </button>
                </div>
                <div className="relative mt-1">
                  <Input
                    id="access-password"
                    required
                    type={showPassword ? "text" : "password"}
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder="Minimal 8 karakter"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="pr-9 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                    aria-pressed={showPassword}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={saving}
                className="w-full bg-slate-950 text-white hover:bg-slate-900"
              >
                {saving ? "Menyimpan…" : "Tambah Pengguna Baru"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Audit 2026-10-31 M7: real dialogs — Escape closes, focus stays inside, labels name their inputs. */}
      <Dialog open={Boolean(editingUser)} onOpenChange={(open) => { if (!open && !saving) setEditingUser(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit profil &amp; peran pengguna</DialogTitle>
            <DialogDescription>
              Perbarui nama, email, dan wewenang akses untuk @{editingUser?.username}.
            </DialogDescription>
          </DialogHeader>
          <form id="access-edit-form" onSubmit={saveUserEdit} className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="access-edit-name" className="text-sm font-medium">Nama lengkap</label>
              <Input
                id="access-edit-name"
                required
                value={editForm.display_name}
                onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="access-edit-email" className="text-sm font-medium">Email</label>
              <Input
                id="access-edit-email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="access-edit-role" className="text-sm font-medium">Role</label>
              <FilterSelect
                id="access-edit-role"
                icon={ShieldCheck}
                value={editForm.role}
                options={ROLE_EDIT_OPTIONS}
                onValueChange={(value) => setEditForm({ ...editForm, role: value })}
              />
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEditingUser(null)}>Batal</Button>
            <Button type="submit" form="access-edit-form" disabled={saving}>{saving ? "Menyimpan…" : "Simpan perubahan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetUser)} onOpenChange={(open) => { if (!open && !saving) setResetUser(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="size-5 text-amber-700" aria-hidden="true" />Reset password sementara</DialogTitle>
            <DialogDescription>
              Buat password sementara baru untuk <strong>@{resetUser?.username}</strong>. Sesi login aktif pengguna ini akan otomatis dicabut.
            </DialogDescription>
          </DialogHeader>
          <form id="access-reset-form" onSubmit={savePasswordReset} className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="access-reset-password" className="text-sm font-medium">Password sementara baru</label>
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setNewPasswordValue(generateRandomPassword())}>
                  Acak ulang
                </Button>
              </div>
              <Input
                id="access-reset-password"
                required
                minLength={8}
                value={newPasswordValue}
                onChange={(e) => setNewPasswordValue(e.target.value)}
                className="font-mono"
              />
            </div>
            <p className="rounded-lg border border-amber-200/80 bg-amber-50 p-3 text-xs text-amber-900">
              Berikan password di atas kepada pengguna. Pengguna wajib mengganti password ini pada login berikutnya.
            </p>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setResetUser(null)}>Batal</Button>
            <Button type="submit" form="access-reset-form" disabled={saving}>{saving ? "Menyimpan…" : "Konfirmasi reset password"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions Matrix Reference Table */}
      <Card className="min-w-0 rounded-xl border-slate-200 shadow-xs">
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <ShieldCheck className="size-5 text-blue-600" aria-hidden="true" />
            Matriks Hak Akses & Matrix Permission per Role
          </CardTitle>
          <p className="text-xs text-slate-500">
            Ringkasan batasan akses halaman & API operasional untuk Owner, Admin, dan Operator Spesialis.
          </p>
        </CardHeader>
        <CardContent className="p-4">
          {/* Mobile view.
              grid-cols-1 is load-bearing: it expands to minmax(0, 1fr). Without it the
              implicit column is sized `auto`, so the card's min-content width — the two
              role cells side by side, neither of which can wrap below its longest word —
              widened the track past the viewport, and Card's own `overflow-hidden`
              clipped the right-hand role column off the screen. */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {PERMISSION_ROWS.map((row) => (
              <section
                key={row.capability}
                className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
              >
                <h3 className="font-semibold text-slate-950">{row.capability}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{row.description}</p>
                <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                  {PERMISSION_COLUMNS.map((column) => {
                    const level = row.access[column.role];
                    const allowed = level === "full";
                    return (
                      <div
                        key={column.role}
                        className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 border border-slate-100"
                      >
                        <span className="text-xs font-semibold text-slate-600">
                          {column.label}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            allowed ? "text-emerald-700" : "text-slate-400"
                          }`}
                        >
                          {allowed ? (
                            <Check className="size-3.5" aria-hidden="true" />
                          ) : (
                            <Minus className="size-3.5" aria-hidden="true" />
                          )}
                          {allowed ? "Akses" : "Restricted"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-slate-50/80">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Area Operasional
                  </th>
                  {PERMISSION_COLUMNS.map((column) => (
                    <th
                      key={column.role}
                      scope="col"
                      className="px-4 py-3.5 text-center"
                    >
                      <span className="text-xs font-semibold text-slate-900">
                        {column.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {PERMISSION_ROWS.map((row) => (
                  <tr key={row.capability} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3.5">
                      <p className="font-semibold text-slate-950">{row.capability}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {row.description}
                      </p>
                    </td>
                    {PERMISSION_COLUMNS.map((column) => {
                      const level = row.access[column.role];
                      const allowed = level === "full";
                      return (
                        <td key={column.role} className="px-4 py-3.5 text-center">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                              allowed
                                ? "bg-emerald-50 text-emerald-800 border border-emerald-200/80"
                                : "bg-slate-100 text-slate-400"
                            }`}
                          >
                            {allowed ? (
                              <>
                                <Check
                                  className="size-3.5 text-emerald-600"
                                  aria-hidden="true"
                                />
                                Akses Penuh
                              </>
                            ) : (
                              <>
                                <Minus className="size-3.5" aria-hidden="true" />
                                Dibatasi
                              </>
                            )}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
