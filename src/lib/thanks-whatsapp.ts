/**
 * The WhatsApp hand-off from /thanks: the message the buyer sends to the
 * store's support number, and whether the page may take them there itself.
 *
 * Only a COD order is redirected. A QRIS, VA or transfer buyer still has to pay
 * from the instructions on the page. A lead-only record is redirected only when
 * it carries an order number: the middle form marks every submission
 * `lead_only` (its total waits on CS) yet has created a real order since
 * 1.5.x, and that buyer is exactly the one CS must confirm on WhatsApp.
 */

export type ThanksWhatsappOrder = {
  storeName: string;
  orderNumber: string;
  customerName: string;
  productName: string;
  variantLabel: string;
  quantity: number;
};

/** Timing of the automatic hand-off, in milliseconds. */
export const THANKS_WHATSAPP_REDIRECT = {
  /** Never sooner: the buyer should see the order was taken. */
  minMs: 1500,
  /** After the Pixel library is up, room for its Purchase request to leave. */
  afterPixelMs: 800,
  /** Never later: the server already holds the COD Purchase, so a browser leg
   * that never loads must not keep the buyer waiting. */
  maxMs: 5000,
} as const;

export function buildThanksWhatsappMessage(order: ThanksWhatsappOrder): string {
  const product = order.productName.trim();
  const variant = order.variantLabel.trim();
  const item = [
    product || variant || "Produk",
    variant && variant.toLowerCase() !== product.toLowerCase() ? `(${variant})` : "",
    `x${Math.max(1, Math.trunc(order.quantity) || 1)}`,
  ]
    .filter(Boolean)
    .join(" ");
  const lines = [
    `Halo ${order.storeName.trim() || "Admin"}, saya sudah memesan:`,
    order.orderNumber.trim() ? `No. Invoice: ${order.orderNumber.trim()}` : "",
    order.customerName.trim() ? `Nama: ${order.customerName.trim()}` : "",
    `Produk: ${item}`,
    "",
    "Mohon segera diproses ya 🙏",
  ];
  return lines.filter((line, index) => line !== "" || index === lines.length - 2).join("\n");
}

/** `wa.me` link for an Indonesian number, or null when the number is unusable. */
export function thanksWhatsappUrl(phone: string, message: string): string | null {
  const digits = String(phone || "").replace(/\D/g, "").replace(/^0/, "62");
  if (!/^62\d{8,13}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** 32-bit FNV-1a: small, fast, and well mixed for short sequential strings. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Which support number an order is handed to (PRD A35). Uniform over the
 * usable numbers, and fixed per order: the same invoice always lands on the
 * same number, so a reload or a return from the payment page never switches
 * the buyer to another agent. The split is statistical — over many orders, not
 * an alternation. Random only when there is no order number to key on.
 */
export function pickThanksWhatsapp(
  numbers: readonly string[],
  orderNumber: string,
  random: () => number = Math.random,
): string | null {
  const usable = numbers.filter((phone) => thanksWhatsappUrl(phone, "") !== null);
  if (!usable.length) return null;
  const key = orderNumber.trim();
  const index = key ? fnv1a(key) % usable.length : Math.floor(random() * usable.length);
  return usable[Math.min(index, usable.length - 1)];
}

export function shouldAutoRedirectToWhatsapp(input: {
  enabled: boolean;
  paymentMethod: string;
  leadOnly: boolean;
  /** The order the thanks page shows; a lead without one is not handed off. */
  orderNumber?: string;
  url: string | null;
}): boolean {
  return (
    input.enabled &&
    (!input.leadOnly || Boolean(input.orderNumber?.trim())) &&
    input.paymentMethod.trim().toLowerCase() === "cod" &&
    Boolean(input.url)
  );
}
