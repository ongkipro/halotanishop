/**
 * Buyer-facing words and number shapes for /payment and /thanks.
 *
 * Both pages used to carry their own copy of the channel names, and /thanks
 * had none at all, so a buyer read the raw `VABCA`, `pending` or
 * `6281234567890` the API hands back. Admin screens keep their own
 * vocabulary in `shipping-status.ts`; these are the words a customer sees.
 */
import { paymentBrandLabel } from "./payment-brand.ts";

export const PAYMENT_CHANNEL_LABELS: Record<string, string> = {
  QRIS: "QRIS (Semua Bank & e-Wallet)",
  VABCA: "Virtual Account BCA",
  VAMANDIRI: "Virtual Account Mandiri",
  VABNI: "Virtual Account BNI",
  VABRI: "Virtual Account BRI",
  VAPERMATA: "Virtual Account Permata",
  VABSI: "Virtual Account BSI",
  VACIMB: "Virtual Account CIMB Niaga",
  VADANAMON: "Virtual Account Danamon",
};

/** "Virtual Account BCA", "Transfer Bank BCA", "QRIS (…)", or the code itself. */
export function paymentChannelLabel(
  channel: string | null | undefined,
  options: { manualTransfer?: boolean } = {},
): string {
  const code = String(channel || "").trim().toUpperCase();
  if (!code) return "";
  if (PAYMENT_CHANNEL_LABELS[code]) return PAYMENT_CHANNEL_LABELS[code];
  if (options.manualTransfer || !code.startsWith("VA")) {
    const bank = paymentBrandLabel(code);
    if (bank && bank !== "QRIS" && bank !== "COD") return `Transfer Bank ${bank}`;
  }
  return code;
}

/**
 * Digits in groups of four — `8808 4409 1104 37` — so a buyer can read a VA
 * or account number back against their banking app. Anything that is not a
 * plain digit string (an alphanumeric payment code) is returned as is: the
 * grouping is for reading only, and the copied value is always the raw one.
 */
export function groupAccountNumber(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{6,}$/.test(digits)) return raw;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** `6281234567890` → `+62 812-3456-7890`; anything unrecognised as is. */
export function formatWhatsappDisplay(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  if (!/^628\d{7,11}$/.test(digits)) return raw;
  const local = digits.slice(2);
  const parts = [local.slice(0, 3), local.slice(3, 7), local.slice(7)].filter(Boolean);
  return `+62 ${parts.join("-")}`;
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu pembayaran",
  unpaid: "Menunggu pembayaran",
  awaiting_payment: "Menunggu pembayaran",
  paid: "Lunas",
  settled: "Lunas",
  success: "Lunas",
  failed: "Gagal",
  expired: "Kedaluwarsa",
  refunded: "Dikembalikan",
};

export const paymentStatusLabel = (status: string | null | undefined) => {
  const key = String(status || "").trim().toLowerCase();
  return PAYMENT_STATUS_LABELS[key] || key.replace(/_/g, " ");
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu diproses toko",
  processing: "Sedang disiapkan",
  shipped: "Dalam pengiriman",
  delivered: "Sudah diterima",
  returned: "Dikembalikan ke toko",
  cancelled: "Dibatalkan",
};

export const orderStatusLabel = (status: string | null | undefined) => {
  const key = String(status || "").trim().toLowerCase();
  return ORDER_STATUS_LABELS[key] || key.replace(/_/g, " ");
};

/**
 * Copy text, falling back to a hidden textarea + `execCommand('copy')` where
 * the async Clipboard API is missing or refuses — non-secure origins and some
 * in-app browsers, which is where ad traffic lands. Returns whether it worked.
 */
export async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    // Deprecated on purpose: it is the fallback for browsers without the
    // async API, so it is reached through a narrowed type, not the lib's.
    const legacy = document as unknown as { execCommand(command: string): boolean };
    const copied = legacy.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}
