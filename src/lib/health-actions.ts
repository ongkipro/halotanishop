import type { HealthSignalId } from "./operational-health.ts";

/**
 * What the operator reads, and what they can do, for each operational signal
 * (PRD A39, REQ-220). The titles and reasons moved here from the retired
 * dashboard card so the status page and its tests read one table.
 *
 * Every reason a signal can report has an entry in `HEALTH_ACTIONS`, even when
 * the entry is `null`: a reason with no fix shows no button rather than a wrong
 * one, and `health-actions.test.ts` fails when a reason is added without
 * deciding which.
 */

export const SIGNAL_TITLES: Record<HealthSignalId, string> = {
  "capi-outbox": "Antrean Meta CAPI",
  "meta-capi": "Pengiriman Meta CAPI terakhir",
  mengantar: "Kontak Mengantar terakhir",
  "receiver-score": "Skor penerima (RTS) Mengantar",
  autolaris: "AutoLaris Create Order & verifikasi",
  "google-ads-outbox": "Antrean Google Ads offline",
  alerting: "Saluran peringatan",
  scheduler: "Tugas terjadwal (cron per jam)",
};

export const REASONS: Record<string, string> = {
  unreadable: "Tabelnya tidak bisa dibaca — cek Workers Logs.",
  // capi-outbox
  empty: "Tidak ada event yang menunggu dikirim.",
  draining: "Ada event menunggu, masih di dalam jadwal retry.",
  stalled: "Event sudah lewat jadwal retry dan belum terkirim — antrean macet.",
  "terminal-failures":
    "Ada conversion yang gagal permanen dan tidak akan pernah sampai ke Meta.",
  "earlier-failures":
    "Tidak ada yang menunggu. Kegagalan lama (lebih dari 24 jam) masih tersimpan dan bisa dikirim ulang dari halaman Ads.",
  // meta-capi
  "never-enqueued": "Belum pernah ada conversion event yang tercatat.",
  "no-delivery-in-window": "Tidak ada pengiriman pada 200 event terakhir.",
  "never-delivered": "Semua event yang tercatat gagal terkirim.",
  failing: "Kegagalan terakhir lebih baru daripada keberhasilan terakhir.",
  delivered: "Meta menerima event terakhir dengan sukses.",
  // mengantar
  "no-orders": "Belum ada order sama sekali.",
  "never-dispatched": "Belum ada order yang dikirim ke Mengantar.",
  "all-attempts-failed": "Semua percobaan dispatch pada jendela ini gagal.",
  dispatched: "Mengantar menerima dispatch terakhir.",
  // receiver-score
  "not-whitelisted":
    "Mengantar menolak cek skor penerima (403 Not allowed): akun belum di-whitelist. Minta akses Receiver Score ke CS Mengantar.",
  "never-scored": "Belum ada order yang sudah dinilai risikonya.",
  scored: "Skor penerima terakhir berhasil diambil dari Mengantar.",
  // autolaris
  "never-used": "Belum pernah ada transaksi payment gateway.",
  "no-accepted-request": "Belum ada request pembayaran yang diterima AutoLaris.",
  "create-failing": "Semua request pembuatan pembayaran gagal.",
  "awaiting-first-payment":
    "Create Order diterima AutoLaris; belum ada pembayaran yang terkonfirmasi.",
  "payment-confirmed": "Pembayaran terakhir telah dikonfirmasi AutoLaris atau operator.",
  "stalled-with-terminal-failures":
    "Ada conversion yang gagal permanen, dan event yang masih bisa dikirim pun sudah lewat jadwal retry — antrean macet.",
  // scheduler
  "scheduler-ran": "Pemeliharaan per jam berjalan: retry CAPI, rekonsiliasi pembayaran, skor penerima, dan plugin.",
  "scheduler-never-ran":
    "Pemeliharaan per jam belum pernah tercatat berjalan. Bila lebih dari satu jam sejak deploy, cek triggers.crons di wrangler.jsonc — tanpa cron, retry CAPI, rekonsiliasi pembayaran, skor penerima, dan plugin tidak berjalan otomatis.",
  "scheduler-stalled":
    "Pemeliharaan per jam berhenti lebih dari dua jam — retry CAPI, rekonsiliasi pembayaran, skor penerima, dan plugin ikut berhenti. Cek Workers Logs dan triggers.crons.",
  // alerting
  configured: "Peringatan dikirim ke webhook operasional.",
  "not-configured":
    "OPS_ALERT_WEBHOOK_URL belum diatur — tidak ada peringatan yang dikirim ke mana pun, dan halaman ini satu-satunya cara mengetahui ada masalah.",
};

export type HealthAction =
  /** A page in this admin that holds the fix. */
  | { kind: "link"; href: string; label: string }
  /** A setting outside the admin: its exact name, copyable, and where it lives. */
  | { kind: "setting"; name: string; where: string }
  /** Something only a person outside this store can do. */
  | { kind: "note"; text: string };

const META: HealthAction = { kind: "link", href: "/admin/ads/meta", label: "Buka Meta Ads" };
const GOOGLE: HealthAction = { kind: "link", href: "/admin/ads/google", label: "Buka Google Ads" };
const MENGANTAR_KEY: HealthAction = {
  kind: "link",
  href: "/admin/profile",
  label: "Cek API key Mengantar",
};
const AUTOLARIS_KEY: HealthAction = {
  kind: "link",
  href: "/admin/profile",
  label: "Cek API key AutoLaris",
};
const PAYMENTS: HealthAction = { kind: "link", href: "/admin/payments", label: "Buka Pembayaran" };
const CRONS: HealthAction = {
  kind: "setting",
  name: "triggers.crons",
  where: "wrangler.jsonc repo install, lalu deploy ulang",
};

/** Signal → reason → its nearest fix, or `null` for none. */
export const HEALTH_ACTIONS: Record<HealthSignalId, Record<string, HealthAction | null>> = {
  "capi-outbox": {
    unreadable: null,
    empty: null,
    draining: null,
    stalled: META,
    "terminal-failures": META,
    "stalled-with-terminal-failures": META,
    "earlier-failures": META,
  },
  "meta-capi": {
    unreadable: null,
    "never-enqueued": null,
    "no-delivery-in-window": META,
    "never-delivered": META,
    failing: META,
    delivered: null,
  },
  mengantar: {
    unreadable: null,
    "no-orders": null,
    "never-dispatched": null,
    "all-attempts-failed": MENGANTAR_KEY,
    dispatched: null,
  },
  "receiver-score": {
    unreadable: null,
    "no-orders": null,
    "not-whitelisted": { kind: "note", text: "Minta akses Receiver Score ke CS Mengantar." },
    "never-scored": null,
    scored: null,
  },
  autolaris: {
    unreadable: null,
    "never-used": null,
    "no-accepted-request": AUTOLARIS_KEY,
    "create-failing": AUTOLARIS_KEY,
    "awaiting-first-payment": PAYMENTS,
    "payment-confirmed": null,
  },
  "google-ads-outbox": {
    unreadable: null,
    empty: null,
    draining: null,
    stalled: GOOGLE,
    "terminal-failures": GOOGLE,
    "stalled-with-terminal-failures": GOOGLE,
    "earlier-failures": GOOGLE,
  },
  alerting: {
    configured: null,
    "not-configured": {
      kind: "setting",
      name: "OPS_ALERT_WEBHOOK_URL",
      where: "Cloudflare → Workers → Settings → Variables and Secrets",
    },
  },
  scheduler: {
    unreadable: null,
    "scheduler-ran": null,
    "scheduler-never-ran": CRONS,
    "scheduler-stalled": CRONS,
  },
};

/** The fix for one signal's reason; null for none and for a reason not in the table. */
export function healthActionFor(id: HealthSignalId, reason: string): HealthAction | null {
  return HEALTH_ACTIONS[id]?.[reason] ?? null;
}
