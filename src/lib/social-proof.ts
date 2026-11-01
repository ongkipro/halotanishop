/**
 * The purchase notice on product and landing pages (A-300).
 *
 * It used to rotate twenty invented buyers ("Ibu Ratna, Bekasi — baru saja
 * memesan") under a verified badge: a fabricated purchase claim. It now states
 * one real aggregate from D1, and states nothing when the number is small.
 * Never an individual: a real buyer's name or city on a public page would be a
 * disclosure of customer data, not social proof.
 */

/** Below this the notice is not shown at all; it is never rounded up. */
export const SOCIAL_PROOF_MIN_ORDERS = 3;

/**
 * The sentence, or null when the count does not earn one. Store-wide and
 * product-free by design: a store runs many landing pages, and one number
 * per store stays true on every one of them.
 */
export function socialProofMessage(count: number): string | null {
  if (!Number.isInteger(count) || count < SOCIAL_PROOF_MIN_ORDERS) return null;
  return `${count.toLocaleString("id-ID")} orang memesan dalam 24 jam terakhir`;
}

/**
 * The store's orders placed in the last 24 hours (one install is one store),
 * excluding void ones (`stock_restored_at`, the order-lifecycle marker),
 * cancelled, returned and abandoned. An abandoned lead is a form someone
 * started and did not submit; counting it told visitors that people ordered
 * who had not. Any failure reads as 0, so the notice is omitted rather than
 * guessed.
 */
export async function recentOrderCount(
  database: D1Database | undefined,
  now: Date = new Date(),
): Promise<number> {
  if (!database?.prepare) return 0;
  try {
    // `created_at >= ?` rather than `unixepoch(created_at) >= ...`: a function
    // on the column cannot use `idx_orders_created_at`, so every page view
    // scanned the whole table (2.1M rows read a day across the fleet, STATUS
    // 2026-10-29). Every writer stores `toISOString()`, so string order is
    // time order.
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const row = await database
      .prepare(
        `SELECT COUNT(*) AS n
           FROM orders
          WHERE created_at >= ?
            AND stock_restored_at IS NULL
            AND shipping_status NOT IN ('cancelled', 'returned', 'abandoned')`,
      )
      .bind(since)
      .first<{ n: number }>();
    return Number(row?.n ?? 0);
  } catch (error) {
    console.error("social-proof-count", error);
    return 0;
  }
}
