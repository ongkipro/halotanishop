import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  HelpCircle,
  RefreshCw,
} from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import type { HealthSignal, HealthState } from "../../lib/operational-health";
import type { HealthSnapshot, StatusIconState } from "../../lib/health-snapshot";
import type { SetupStep } from "../../lib/setup-checklist";
import {
  healthActionFor,
  REASONS,
  SIGNAL_TITLES,
  type HealthAction,
} from "../../lib/health-actions";
import { rememberStatusIcon } from "./OperationalStatusIcon";

/**
 * `/admin/status` (PRD A39, REQ-219): the overall state with **Periksa ulang**,
 * then what needs action, the store setup checklist, and every signal.
 *
 * Moved from the dashboard's "Kesehatan operasional" card. The three signal
 * states stay visually distinct on purpose: "Belum ada data" is amber and
 * quiet; only a real fault is red. Conflating them is how a health panel stops
 * being read.
 */

const STATE_LABEL: Record<HealthState, string> = {
  healthy: "Sehat",
  degraded: "Bermasalah",
  unknown: "Belum ada data",
};

const STATE_TONE: Record<HealthState, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  degraded: "border-rose-200 bg-rose-50 text-rose-800",
  unknown: "border-amber-200 bg-amber-50 text-amber-800",
};

const STATE_ICON: Record<HealthState, typeof CheckCircle2> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  unknown: HelpCircle,
};

const OVERALL: Record<StatusIconState["tone"], { title: string; tone: string }> = {
  problem: { title: "Ada yang perlu ditangani", tone: "border-rose-200 bg-rose-50 text-rose-900" },
  setup: { title: "Setup toko belum selesai", tone: "border-amber-200 bg-amber-50 text-amber-900" },
  healthy: { title: "Semua sinyal sehat", tone: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  unknown: { title: "Belum ada data", tone: "border-slate-200 bg-slate-50 text-slate-800" },
};

function formatAge(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

function minutesSince(at: string | null, now: number) {
  if (!at) return null;
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? null : Math.max(0, Math.floor((now - parsed) / 60_000));
}

// The snapshot is stored JSON, possibly written by an older or newer build:
// a state or tone this build does not know degrades to "unknown" rather than
// indexing a map to undefined and throwing — an SSR throw is a blank page.
function knownState(state: unknown): HealthState {
  return state === "healthy" || state === "degraded" ? state : "unknown";
}

function describeMetrics(signal: HealthSignal) {
  const metrics = signal.metrics ?? {};
  // Both outboxes carry the same three counters and fail the same way, so they
  // read the same way too — an operator should not have to learn a second
  // vocabulary for the second queue.
  if (signal.id === "capi-outbox" || signal.id === "google-ads-outbox") {
    const { pending = 0, failed = 0, overdue = 0 } = metrics;
    return `${pending} menunggu · ${overdue} lewat jadwal · ${failed} gagal permanen`;
  }
  if (signal.id === "receiver-score") {
    const refused = metrics.refusedInWindow ?? 0;
    return refused > 0 ? `${refused} order belum dinilai karena akses ditolak, pada 200 baris terakhir` : null;
  }
  const failed = metrics.failedInWindow;
  return typeof failed === "number" && failed > 0
    ? `${failed} kegagalan tercatat pada 200 baris terakhir`
    : null;
}

function ageLabel(signal: HealthSignal) {
  if (signal.id === "autolaris") {
    return signal.reason === "payment-confirmed"
      ? "Pembayaran terakhir"
      : "Create Order terakhir";
  }
  return signal.id === "capi-outbox" || signal.id === "google-ads-outbox"
    ? "Antrean tertua"
    : "Terakhir sukses";
}

function CopyableSetting({ name, where }: { name: string; where: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <code className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-900">
        {name}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(name);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        <Copy aria-hidden />
        {copied ? "Tersalin" : "Salin nama"}
      </Button>
      <span>di {where}</span>
    </div>
  );
}

function ActionFor({ action }: { action: HealthAction | null }) {
  if (!action) return null;
  if (action.kind === "link") {
    return (
      <a href={action.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {action.label}
      </a>
    );
  }
  if (action.kind === "setting") return <CopyableSetting name={action.name} where={action.where} />;
  return <p className="text-xs font-medium text-slate-700">{action.text}</p>;
}

function SignalRow({ signal, now }: { signal: HealthSignal; now: number }) {
  const state = knownState(signal.state);
  const Icon = STATE_ICON[state];
  const metrics = describeMetrics(signal);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">{SIGNAL_TITLES[signal.id] ?? signal.id}</p>
          <p className="text-xs leading-relaxed text-slate-500">
            {REASONS[signal.reason] || signal.reason}
            {metrics ? ` · ${metrics}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Alerting reports a configuration, not an event, so it has no
              timestamp — and "Terakhir sukses —" beside it reads as a missing
              measurement rather than an absent one. */}
          {signal.id !== "alerting" && (
            <span className="text-right text-xs text-slate-500">
              {ageLabel(signal)}
              <br />
              <span className="font-medium text-slate-700">
                {formatAge(minutesSince(signal.lastAt, now))}
              </span>
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${STATE_TONE[state]}`}
          >
            <Icon className="size-3.5" aria-hidden />
            {STATE_LABEL[state]}
          </span>
        </div>
      </div>
      <ActionFor action={healthActionFor(signal.id, signal.reason)} />
    </li>
  );
}

type Props = {
  snapshot: HealthSnapshot | null;
  icon: StatusIconState;
  setupSteps: SetupStep[] | null;
  /** Server time of the render, so SSR and hydration agree on every age. */
  now: number;
};

export default function OperationalStatus({ snapshot: initialSnapshot, icon: initialIcon, setupSteps, now: renderedAt }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [icon, setIcon] = useState(initialIcon);
  const [now, setNow] = useState(renderedAt);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/health/check", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false || !payload.snapshot) {
        throw new Error(payload.error || "Pemeriksaan gagal.");
      }
      setSnapshot(payload.snapshot as HealthSnapshot);
      setIcon(payload.icon as StatusIconState);
      setNow(Date.now());
      rememberStatusIcon(payload.icon as StatusIconState);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pemeriksaan gagal.");
    } finally {
      setChecking(false);
    }
  };

  const signals = (snapshot?.health?.signals ?? []).filter(
    (signal): signal is HealthSignal => Boolean(signal) && typeof signal === "object",
  );
  // A stalled snapshot's stored signals are as old as the snapshot; they are
  // still listed, but the stall is the first thing to fix.
  const degraded = signals.filter((signal) => signal.state === "degraded");
  const rest = signals.filter((signal) => signal.state !== "degraded");
  const requiredLeft = (setupSteps ?? []).filter((step) => step.required && !step.done);
  const doneCount = (setupSteps ?? []).filter((step) => step.done).length;
  const takenAge = minutesSince(snapshot?.takenAt ?? null, now);
  // The scheduled run's age, on the same basis as `staleReason` in
  // health-snapshot.ts (inlined so the island does not bundle the server-side
  // collector that module imports). Which clock went stale comes from the icon.
  const runAge = minutesSince(snapshot?.schedulerRanAt ?? snapshot?.takenAt ?? null, now);
  const overall = OVERALL[icon.tone] ?? OVERALL.unknown;
  const build = snapshot?.health?.build;

  return (
    <div className="space-y-4 md:space-y-5">
      <section
        aria-labelledby="status-overall"
        className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between md:p-5 ${overall.tone}`}
      >
        <div className="min-w-0">
          <h3 id="status-overall" className="text-base font-semibold">
            {overall.title}
          </h3>
          <p className="mt-1 text-sm" aria-live="polite">
            {icon.label}.{" "}
            {snapshot?.takenAt
              ? `Diperiksa ${formatAge(takenAge)}.`
              : "Belum pernah diperiksa. Pemeriksaan per jam akan mengisinya, atau periksa sekarang."}
          </p>
          {error && <p className="mt-1 text-sm font-medium text-rose-800">{error}</p>}
        </div>
        <Button type="button" variant="outline" onClick={() => void recheck()} disabled={checking} className="shrink-0 bg-white">
          <RefreshCw className={checking ? "animate-spin" : undefined} aria-hidden />
          {checking ? "Memeriksa…" : "Periksa ulang"}
        </Button>
      </section>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle as="h3" className="text-sm font-semibold text-slate-950 md:text-base">
            Perlu tindakan
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {!icon.stale && degraded.length === 0 && requiredLeft.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada yang perlu ditangani sekarang.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2">
              {icon.stale && (
                <li className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                  {icon.staleReason === "snapshot" ? (
                    <>
                      <p className="text-sm font-medium text-rose-900">Status tidak diperbarui</p>
                      <p className="text-xs leading-relaxed text-rose-800">
                        Pemeliharaan per jam masih berjalan ({formatAge(runAge)}), tetapi status terakhir tertulis{" "}
                        {formatAge(takenAge)}, jadi sinyal di bawah bisa sudah usang. Cek Workers Logs untuk
                        scheduled-health-snapshot-failed.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-rose-900">Pemeliharaan berhenti</p>
                      <p className="text-xs leading-relaxed text-rose-800">
                        Pemeliharaan per jam terakhir berjalan {formatAge(runAge)}. Ia tidak lagi menulis status, jadi
                        sinyal di bawah bisa sudah usang — retry CAPI, rekonsiliasi pembayaran, skor penerima, dan
                        plugin kemungkinan ikut berhenti. Cek Workers Logs dan triggers.crons.
                      </p>
                      <ActionFor action={healthActionFor("scheduler", "scheduler-stalled")} />
                    </>
                  )}
                </li>
              )}
              {degraded.map((signal) => (
                <SignalRow key={signal.id} signal={signal} now={now} />
              ))}
              {requiredLeft.map((step) => (
                <li key={step.id} className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{step.label}</p>
                    <p className="text-xs text-slate-500">Langkah setup wajib. {step.hint}</p>
                  </div>
                  <a href={step.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Buka
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {setupSteps && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <CardTitle as="h3" className="text-sm font-semibold text-slate-950 md:text-base">
              Setup toko
            </CardTitle>
            <span className="text-xs font-semibold tabular-nums text-slate-600">
              {doneCount}/{setupSteps.length} selesai
            </span>
          </CardHeader>
          <CardContent className="pt-2">
            <ol className="divide-y divide-slate-100">
              {setupSteps.map((step) => (
                <li key={step.id} className="flex items-start gap-3 py-3">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      step.done ? "bg-emerald-600 text-white" : "border border-slate-300 text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${step.done ? "text-slate-400 line-through" : "text-slate-900"}`}>
                      {step.label}
                      {!step.required && <span className="ml-1 text-xs font-normal text-slate-400">(opsional)</span>}
                      <span className="sr-only">{step.done ? " — selesai" : " — belum"}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{step.hint}</p>
                  </div>
                  {!step.done && (
                    <a href={step.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      Buka
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {rest.length > 0 && (
        <details className="group rounded-xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-slate-950 md:px-5">
            <span>Semua sinyal</span>
            <span className="text-xs font-medium text-slate-500">
              {rest.length} sinyal sehat atau belum ada data
            </span>
          </summary>
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 md:px-5">
            <p className="mb-3 text-xs text-slate-500">
              &quot;Belum ada data&quot; berarti belum pernah tercatat, bukan gagal.
            </p>
            <ul className="grid grid-cols-1 gap-2">
              {rest.map((signal) => (
                <SignalRow key={signal.id} signal={signal} now={now} />
              ))}
            </ul>
          </div>
        </details>
      )}

      {build && (
        <p className="text-xs text-slate-500">
          Versi {build.version} ({build.releaseTag}) · skema{" "}
          {build.appliedSchemaVersion ?? "?"}/{build.expectedSchemaVersion}
          {build.schemaState === "match" ? "" : ` · ${build.schemaState}`}
        </p>
      )}
    </div>
  );
}
