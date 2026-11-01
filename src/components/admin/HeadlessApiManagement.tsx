import { useEffect, useState, type SubmitEvent } from "react";
import { useConfirm } from "./useConfirm";
import { Check, Copy, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ApiKeyScope } from "@/lib/developer-api-keys";

type HeadlessScope = ApiKeyScope;

type DeveloperApiKey = {
  id: number;
  name: string;
  key_preview: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  scopes: HeadlessScope[];
  rate_limit_per_minute: number;
  daily_quota: number;
  active: boolean;
};

type HeadlessAuditEvent = {
  id: number;
  api_key_id: number;
  key_name: string;
  operation: string;
  outcome: string;
  status_code: number;
  created_at: string;
};

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
};

type KeyListData = { keys: DeveloperApiKey[]; audit_events: HeadlessAuditEvent[] };
type KeyCreationData = { key: DeveloperApiKey; secret: string };

const SCOPE_OPTIONS: ReadonlyArray<{ value: HeadlessScope; label: string }> = [
  { value: "storefront:read", label: "Storefront" },
  { value: "catalog:read", label: "Katalog" },
  { value: "shipping:read", label: "Ongkir" },
  { value: "checkout:write", label: "Checkout" },
  { value: "orders:read", label: "Status order" },
  { value: "tracking:write", label: "Tracking" },
  // The operations API (PRD A45, /api/ops/v1). Only the owner may issue a key
  // with any of these, and none is ever on by default.
  { value: "ops:orders:read", label: "Ops · Baca order" },
  { value: "ops:orders:read_pii", label: "Ops · Data pembeli" },
  { value: "ops:orders:write", label: "Ops · Aksi order" },
  { value: "ops:shipping:write", label: "Ops · Kirim & pickup" },
  { value: "ops:reports:read", label: "Ops · Laporan" },
  { value: "ops:catalog:read", label: "Ops · Katalog" },
];

const DEFAULT_SCOPES = SCOPE_OPTIONS.map((scope) => scope.value).filter((scope) => !scope.startsWith("ops:"));
const AUDIT_OUTCOME_LABELS: Record<string, string> = {
  allowed: "Diizinkan",
  scope_denied: "Scope ditolak",
  rate_limited: "Batas menit tercapai",
  quota_exhausted: "Kuota harian habis",
  origin_denied: "Origin ditolak",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  return (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Belum digunakan";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE_FORMATTER.format(date);
}

export function HeadlessApiManagement() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [keys, setKeys] = useState<DeveloperApiKey[]>([]);
  const [auditEvents, setAuditEvents] = useState<HeadlessAuditEvent[]>([]);
  const [name, setName] = useState("");
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [scopes, setScopes] = useState<HeadlessScope[]>([...DEFAULT_SCOPES]);
  const [rateLimit, setRateLimit] = useState(120);
  const [dailyQuota, setDailyQuota] = useState(10_000);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftScopes, setDraftScopes] = useState<HeadlessScope[]>([]);
  const [draftRateLimit, setDraftRateLimit] = useState(120);
  const [draftDailyQuota, setDraftDailyQuota] = useState(10_000);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/admin/settings/developer", {
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const payload = await readEnvelope<KeyListData>(response);
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || "Daftar API key gagal dimuat.");
        }
        if (!cancelled) {
          setKeys(payload.data.keys);
          setAuditEvents(payload.data.audit_events);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Daftar API key gagal dimuat.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const createKey = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setGeneratedSecret(null);
    setCopied(false);

    try {
      const response = await fetch("/api/admin/settings/developer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          scopes,
          rate_limit_per_minute: rateLimit,
          daily_quota: dailyQuota,
        }),
      });
      const payload = await readEnvelope<KeyCreationData>(response);
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || "API key gagal dibuat.");
      }

      const creation = payload.data;
      setKeys((current) => [creation.key, ...current]);
      setGeneratedSecret(creation.secret);
      setName("");
      toast.success(payload.message || "API key berhasil dibuat.");
      setScopes([...DEFAULT_SCOPES]);
      setRateLimit(120);
      setDailyQuota(10_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "API key gagal dibuat.");
    } finally {
      setCreating(false);
    }
  };

  const toggleScope = (
    scope: HeadlessScope,
    current: HeadlessScope[],
    update: (next: HeadlessScope[]) => void,
  ) => {
    update(
      current.includes(scope)
        ? current.filter((candidate) => candidate !== scope)
        : [...current, scope],
    );
  };

  const beginPolicyEdit = (key: DeveloperApiKey) => {
    setEditingId(key.id);
    setDraftScopes([...key.scopes]);
    setDraftRateLimit(key.rate_limit_per_minute);
    setDraftDailyQuota(key.daily_quota);
  };

  const savePolicy = async () => {
    if (!editingId || savingPolicy) return;
    setSavingPolicy(true);
    try {
      const response = await fetch("/api/admin/settings/developer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          scopes: draftScopes,
          rate_limit_per_minute: draftRateLimit,
          daily_quota: draftDailyQuota,
        }),
      });
      const payload = await readEnvelope<{ key: Pick<
        DeveloperApiKey,
        "id" | "scopes" | "rate_limit_per_minute" | "daily_quota"
      > }>(response);
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || "Kebijakan API key gagal disimpan.");
      }
      const updated = payload.data.key;
      setKeys((current) =>
        current.map((key) => key.id === updated.id ? { ...key, ...updated } : key),
      );
      setEditingId(null);
      toast.success(payload.message || "Kebijakan API key berhasil disimpan.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kebijakan API key gagal disimpan.");
    } finally {
      setSavingPolicy(false);
    }
  };

  const copySecret = async () => {
    if (!generatedSecret) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard tidak tersedia di browser ini.");
      await navigator.clipboard.writeText(generatedSecret);
      setCopied(true);
      toast.success("API key disalin ke clipboard.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "API key gagal disalin.");
    }
  };

  const revokeKey = async (key: DeveloperApiKey) => {
    if (!(await confirm({ title: "Cabut API key?", description: `API key “${key.name}” langsung tidak berlaku. Integrasi yang memakainya berhenti.`, confirmLabel: "Cabut key" }))) {
      return;
    }

    setRevokingId(key.id);
    try {
      const response = await fetch("/api/admin/settings/developer", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: key.id }),
      });
      const payload = await readEnvelope<Record<string, never>>(response);
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "API key gagal dicabut.");
      }
      setKeys((current) => current.filter((item) => item.id !== key.id));
      toast.success(payload.message || "API key berhasil dicabut.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "API key gagal dicabut.");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      {confirmDialog}
      <Card className="min-w-0">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle as="h3" className="flex items-center gap-2 text-base font-semibold">
                <KeyRound className="size-4 text-blue-600" aria-hidden="true" />
                API Key Aktif
              </CardTitle>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Gunakan key server-side untuk integrasi privat. Secret lengkap hanya ditampilkan saat dibuat.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              {keys.length} aktif
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3" role="status" aria-label="Memuat API key">
              <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
              <KeyRound className="mx-auto size-7 text-slate-400" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-slate-800">Belum ada API key aktif</p>
              <p className="mt-1 text-xs text-slate-500">Buat key pertama untuk menghubungkan backend eksternal.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => {
                const editing = editingId === key.id;
                return (
                  <section key={key.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{key.name}</p>
                        <p className="mt-1 break-all font-mono text-xs text-slate-600">{key.key_preview}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Dibuat {formatTimestamp(key.created_at)} oleh {key.created_by} · Terakhir dipakai {formatTimestamp(key.last_used_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          
                          onClick={() => editing ? setEditingId(null) : beginPolicyEdit(key)}
                          aria-expanded={editing}
                        >
                          {editing ? "Batal" : "Atur kebijakan"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={revokingId !== null}
                          onClick={() => void revokeKey(key)}
                          className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          {revokingId === key.id ? "Mencabut…" : "Cabut"}
                        </Button>
                      </div>
                    </div>
                    {editing ? (
                      <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                        <fieldset>
                          <legend className="text-xs font-semibold text-slate-700">Scope yang diizinkan</legend>
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {SCOPE_OPTIONS.map((scope) => (
                              <label key={scope.value} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={draftScopes.includes(scope.value)}
                                  onChange={() => toggleScope(scope.value, draftScopes, setDraftScopes)}
                                  className="size-4"
                                />
                                {scope.label}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <label className="grid grid-cols-1 gap-2 text-xs font-semibold text-slate-700">
                            Request per menit
                            <Input
                              type="number"
                              min={1}
                              max={600}
                              value={draftRateLimit}
                              
                              onChange={(event) => setDraftRateLimit(Number(event.target.value))}
                            />
                          </label>
                          <label className="grid grid-cols-1 gap-2 text-xs font-semibold text-slate-700">
                            Kuota per hari
                            <Input
                              type="number"
                              min={1}
                              max={100000}
                              value={draftDailyQuota}
                              
                              onChange={(event) => setDraftDailyQuota(Number(event.target.value))}
                            />
                          </label>
                        </div>
                        <Button
                          type="button"
                          disabled={savingPolicy || draftScopes.length === 0}
                          onClick={() => void savePolicy()}
                          
                        >
                          {savingPolicy ? "Menyimpan…" : "Simpan kebijakan"}
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {key.scopes.map((scope) => (
                          <span key={scope} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                            {SCOPE_OPTIONS.find((option) => option.value === scope)?.label || scope}
                          </span>
                        ))}
                        <span className="text-xs font-semibold text-slate-500">
                          {key.rate_limit_per_minute}/menit · {key.daily_quota.toLocaleString("id-ID")}/hari
                        </span>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          {!loading && (
            <section className="mt-6 border-t border-slate-200 pt-5" aria-labelledby="headless-audit-title">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 id="headless-audit-title" className="text-sm font-semibold text-slate-900">Aktivitas API terbaru</h4>
                  <p className="mt-1 text-xs text-slate-500">Hanya keputusan autentikasi, scope, dan kuota. Payload tidak disimpan.</p>
                </div>
                <span className="text-xs font-semibold text-slate-500">{auditEvents.length} event</span>
              </div>
              {auditEvents.length === 0 ? (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-xs text-slate-500">Belum ada penggunaan API tercatat.</p>
              ) : (
                <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2" scope="col">Waktu</th>
                        <th className="px-3 py-2" scope="col">Key</th>
                        <th className="px-3 py-2" scope="col">Operasi</th>
                        <th className="px-3 py-2" scope="col">Hasil</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {auditEvents.map((event) => (
                        <tr key={event.id}>
                          <td className="px-3 py-2 text-slate-500">{formatTimestamp(event.created_at)}</td>
                          <td className="px-3 py-2 font-semibold text-slate-700">{event.key_name}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-600">{event.operation}</td>
                          <td className="px-3 py-2 text-slate-600">{AUDIT_OUTCOME_LABELS[event.outcome] || "Ditolak"} · {event.status_code}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h3" className="text-sm font-semibold">Buat API Key Instan</CardTitle>
          <p className="text-xs leading-5 text-slate-500">Beri nama sesuai aplikasi atau lingkungan pemakai.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={createKey} className="space-y-3">
            <label className="grid-cols-1 grid gap-2 text-xs font-semibold text-slate-700">
              Nama key
              <Input
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Contoh: Storefront Production"
                autoComplete="off"
                
              />
            </label>
            <fieldset>
              <legend className="text-xs font-semibold text-slate-700">Scope awal</legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {SCOPE_OPTIONS.map((scope) => (
                  <label key={scope.value} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope.value)}
                      onChange={() => toggleScope(scope.value, scopes, setScopes)}
                      className="size-4"
                    />
                    {scope.label}
                  </label>
                ))}
              </div>
            </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <label className="grid grid-cols-1 gap-2 text-xs font-semibold text-slate-700">
                Request per menit
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={rateLimit}
                  
                  onChange={(event) => setRateLimit(Number(event.target.value))}
                />
              </label>
            <label className="grid grid-cols-1 gap-2 text-xs font-semibold text-slate-700">
                Kuota per hari
                <Input
                  type="number"
                  min={1}
                  max={100000}
                  value={dailyQuota}
                  
                  onChange={(event) => setDailyQuota(Number(event.target.value))}
                />
              </label>
            </div>
            <Button type="submit" disabled={creating || scopes.length === 0} className="w-full">
              <KeyRound className="size-4" aria-hidden="true" />
              {creating ? "Membuat…" : "Generate API Key"}
            </Button>
          </form>

          {generatedSecret && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3" role="status" aria-live="polite">
              <p className="text-xs font-semibold text-amber-900">Salin sekarang — key tidak akan ditampilkan lagi.</p>
              <div className="mt-2 flex gap-2">
                <Input
                  readOnly
                  value={generatedSecret}
                  className="min-w-0 font-mono"
                  aria-label="API key baru"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void copySecret()}
                  aria-label={copied ? "API key sudah disalin" : "Salin API key"}
                  className={copied ? "min-h-11 min-w-11 border-emerald-300 bg-emerald-50 text-emerald-700" : "min-h-11 min-w-11 bg-white"}
                >
                  {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                </Button>
              </div>
              <p className="mt-2 min-h-4 text-xs font-semibold text-emerald-700">{copied ? "Tersalin ke clipboard." : ""}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
