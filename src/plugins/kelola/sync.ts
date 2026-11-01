/**
 * The Kelola plugin's work: every new order pushed to the Kelola CRM
 * (Penjualan) of one toko.
 *
 * Runs only while the plugin is active (src/plugins/registry.ts) and a URL +
 * secret pair is configured. Kelola's toko settings issue the pair. The pair
 * saved at /admin/settings/plugins/kelola (`plugins.settings`) wins over the
 * `KELOLA_ORDER_WEBHOOK_URL` / `_SECRET` env fallback. Push state lives in the
 * plugin's own table, `plugin_kelola_orders`. The request is signed like
 * Kelola's Mengantar webhook: HMAC-SHA256 hex over `{x-timestamp}.{raw body}`.
 *
 * Kelola keys the order on `code` = our order number, so a resend is answered
 * as a duplicate rather than a second sale. That makes the delivery here
 * at-least-once on purpose: a push right after checkout (`waitUntil`), then
 * the hourly cron retries whatever Kelola has not accepted yet, and an operator
 * can resend one order from its detail page.
 *
 * An abandoned order is never pushed as a sale. Once it has stayed abandoned
 * past a grace period the cron sends it to Kelola's lead webhook instead, for
 * CS to follow up (`drainKelolaLeads`).
 */
import { getEnvValue } from "../../lib/env.ts";

/** Orders older than this are left alone — also stops a first enable from
 *  replaying the store's whole history into Kelola. */
export const KELOLA_RETRY_WINDOW_HOURS = 24;
const PUSH_TIMEOUT_MS = 10_000;
const DRAIN_BATCH = 50;

type OrderRow = {
  id: number;
  order_number: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  province: string;
  city: string;
  district: string;
  postal_code: string | null;
  shipping_cost: number;
  discount_amount: number | null;
  total_amount: number;
  payment_method: string;
};
type ItemRow = { sku: string; name: string; quantity: number; unit_price: number; weight_grams: number };

type KelolaConfig = { url: string; secret: string; source?: "dashboard" | "server" };

export function readKelolaConfig(env: Parameters<typeof getEnvValue>[1]): KelolaConfig | null {
  const url = getEnvValue("KELOLA_ORDER_WEBHOOK_URL", env);
  const secret = getEnvValue("KELOLA_ORDER_WEBHOOK_SECRET", env);
  return url && secret ? { url, secret, source: "server" } : null;
}

/** Dashboard pair first, env pair as the fallback; null = the push is off. */
export function getKelolaConfig(
  settings: Record<string, unknown>,
  env: Parameters<typeof getEnvValue>[1],
): KelolaConfig | null {
  const url = typeof settings.webhook_url === "string" ? settings.webhook_url.trim() : "";
  const secret = typeof settings.webhook_secret === "string" ? settings.webhook_secret.trim() : "";
  return url && secret ? { url, secret, source: "dashboard" } : readKelolaConfig(env);
}

/**
 * A pasted webhook URL, or null when it cannot be one Kelola issued. HTTPS
 * only: the body carries buyer names, phones and addresses.
 */
export function normalizeKelolaWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" && /^\/api\/public\/toko\/order\/[^/]+$/.test(url.pathname) && !url.search
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** The URL with its token hidden — the token alone routes to the toko. */
export function maskKelolaWebhookUrl(url: string) {
  const token = url.split("/").pop() ?? "";
  return `${url.slice(0, url.length - token.length)}${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * Prove URL + secret without creating an order: a correctly signed empty body
 * passes Kelola's token and signature checks and stops at validation (400).
 */
export async function testKelolaConnection(
  config: KelolaConfig,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; message: string }> {
  const body = "{}";
  const timestamp = String(Date.now());
  try {
    const response = await fetcher(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-timestamp": timestamp,
        "x-signature": await signKelolaBody(config.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (response.status === 400) return { ok: true, message: "Terhubung: URL dan secret diterima Kelola." };
    if (response.status === 404) return { ok: false, message: "Kelola tidak mengenal URL ini. Sambungkan ulang toko di Kelola lalu tempel URL barunya." };
    if (response.status === 401) return { ok: false, message: "Secret tidak cocok dengan URL ini, atau jam server berselisih lebih dari 5 menit." };
    return { ok: false, message: `Kelola membalas HTTP ${response.status}.` };
  } catch (error) {
    return { ok: false, message: `Kelola tidak terjangkau: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** What the plugin's settings page shows: is the push keeping up, and what broke last. */
export async function kelolaSyncStatus(database: D1Database, now = new Date()) {
  const since = new Date(now.getTime() - KELOLA_RETRY_WINDOW_HOURS * 3_600_000).toISOString();
  const counts = await database
    .prepare(
      `SELECT MAX(k.synced_at) AS last_synced_at,
              SUM(CASE WHEN k.synced_at IS NOT NULL AND o.created_at >= ?1 THEN 1 ELSE 0 END) AS synced_24h,
              SUM(CASE WHEN k.synced_at IS NULL AND k.attempts > 0 AND o.created_at >= ?1 THEN 1 ELSE 0 END) AS failing_24h
       FROM plugin_kelola_orders k
       JOIN orders o ON o.id = k.order_id
       WHERE o.shipping_status != 'abandoned' AND o.stock_restored_at IS NULL`,
    )
    .bind(since)
    .first<{ last_synced_at: string | null; synced_24h: number | null; failing_24h: number | null }>();
  const lastError = await database
    .prepare(
      `SELECT o.order_number, k.attempts, k.last_error AS message
       FROM plugin_kelola_orders k
       JOIN orders o ON o.id = k.order_id
       WHERE k.synced_at IS NULL AND k.last_error IS NOT NULL
         AND o.shipping_status != 'abandoned' AND o.stock_restored_at IS NULL AND o.created_at >= ?
       ORDER BY o.id DESC LIMIT 1`,
    )
    .bind(since)
    .first<{ order_number: string; attempts: number; message: string }>();
  // Orders the cron will never retry: older than the window and not in Kelola.
  // LEFT JOIN, because an order taken before the plugin was on has no row.
  const older = await database
    .prepare(
      `SELECT COUNT(*) AS n FROM orders o
       LEFT JOIN plugin_kelola_orders k ON k.order_id = o.id
       WHERE k.synced_at IS NULL AND o.shipping_status != 'abandoned'
         AND o.stock_restored_at IS NULL AND o.created_at < ?`,
    )
    .bind(since)
    .first<{ n: number }>();
  return {
    last_synced_at: counts?.last_synced_at ?? null,
    synced_24h: Number(counts?.synced_24h ?? 0),
    failing_24h: Number(counts?.failing_24h ?? 0),
    unsynced_older: Number(older?.n ?? 0),
    last_error: lastError ?? null,
  };
}

/** The body Kelola's `/api/public/toko/order/:token` validates. */
export function kelolaOrderPayload(order: OrderRow, items: ItemRow[]) {
  const cod = order.payment_method === "cod";
  return {
    code: order.order_number,
    // created_at is UTC ISO; Kelola's order date is the WIB calendar day.
    date: new Date(Date.parse(order.created_at) + 7 * 3_600_000).toISOString().slice(0, 10),
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    address: order.address,
    kecamatan: order.district || undefined,
    kota: order.city || undefined,
    provinsi: order.province || undefined,
    kodePos: order.postal_code || undefined,
    payment: cod ? "cod" : "transfer",
    ongkir: order.shipping_cost,
    discount: order.discount_amount ?? 0,
    // What the courier collects, COD fee included when the buyer bears it.
    codValue: cod ? order.total_amount : null,
    berat: items.reduce((sum, item) => sum + item.weight_grams * item.quantity, 0),
    items: items.map((item) => ({
      sku: item.sku,
      name: item.name,
      qty: item.quantity,
      price: item.unit_price,
    })),
  };
}

export async function signKelolaBody(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Push one order; returns true once Kelola holds it (created or duplicate).
 * Never throws — the outcome is recorded on the order row for the next try.
 */
export async function pushOrderToKelola(
  database: D1Database,
  config: KelolaConfig,
  orderId: number,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const order = await database
      .prepare(
        `SELECT id, order_number, created_at, customer_name, customer_phone, address,
                province, city, district, postal_code, shipping_cost, discount_amount,
                total_amount, payment_method
         FROM orders o
         WHERE o.id = ? AND o.shipping_status != 'abandoned' AND o.stock_restored_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM plugin_kelola_orders k WHERE k.order_id = o.id AND k.synced_at IS NOT NULL)`,
      )
      .bind(orderId)
      .first<OrderRow>();
    if (!order) return false;
    const { results: items } = await database
      .prepare(
        `SELECT pv.sku, p.title || CASE WHEN pv.title = p.title THEN '' ELSE ' - ' || pv.title END AS name,
                oi.quantity, oi.unit_price, COALESCE(oi.weight_grams, pv.weight_grams) AS weight_grams
         FROM order_items oi
         JOIN product_variants pv ON pv.id = oi.variant_id
         JOIN products p ON p.id = pv.product_id
         WHERE oi.order_id = ?
         ORDER BY oi.id`,
      )
      .bind(orderId)
      .all<ItemRow>();
    if (!items.length) return false;

    const body = JSON.stringify(kelolaOrderPayload(order, items));
    const timestamp = String(Date.now());
    const response = await fetcher(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-timestamp": timestamp,
        "x-signature": await signKelolaBody(config.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (response.ok) {
      await database
        .prepare(
          `INSERT INTO plugin_kelola_orders (order_id, synced_at) VALUES (?1, ?2)
           ON CONFLICT(order_id) DO UPDATE SET synced_at = ?2, last_error = NULL`,
        )
        .bind(orderId, new Date().toISOString())
        .run();
      return true;
    }
    await recordFailure(database, orderId, `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  } catch (error) {
    await recordFailure(database, orderId, error instanceof Error ? error.message : String(error)).catch(() => {});
  }
  return false;
}

function recordFailure(database: D1Database, orderId: number, message: string) {
  console.error("kelola-order-push-failed", { orderId, message });
  return database
    .prepare(
      `INSERT INTO plugin_kelola_orders (order_id, attempts, last_error) VALUES (?1, 1, ?2)
       ON CONFLICT(order_id) DO UPDATE SET attempts = attempts + 1, last_error = ?2`,
    )
    .bind(orderId, message)
    .run();
}

/** One order's push as its detail page shows it. */
export async function kelolaOrderState(database: D1Database, config: KelolaConfig | null, orderId: number) {
  const row = await database
    .prepare(
      `SELECT k.synced_at, k.attempts, k.last_error, o.stock_restored_at
       FROM orders o LEFT JOIN plugin_kelola_orders k ON k.order_id = o.id
       WHERE o.id = ?`,
    )
    .bind(orderId)
    .first<{ synced_at: string | null; attempts: number | null; last_error: string | null; stock_restored_at: string | null }>();
  return {
    configured: Boolean(config),
    synced_at: row?.synced_at ?? null,
    attempts: Number(row?.attempts ?? 0),
    last_error: row?.last_error ?? null,
    voided: Boolean(row?.stock_restored_at),
  };
}

/**
 * The detail page's "send again". Not bound by the cron's 24h window — an
 * operator asked for this order. An order Kelola already holds is not re-sent.
 */
export async function resendOrderToKelola(database: D1Database, config: KelolaConfig | null, orderId: number) {
  const before = await kelolaOrderState(database, config, orderId);
  if (!config) return { ok: false, error: "Kelola CRM belum dihubungkan di Pengaturan → Plugin.", state: before };
  if (before.voided) return { ok: false, error: "Order yang dibatalkan tidak dikirim ke Kelola.", state: before };
  if (before.synced_at) return { ok: true, state: before };
  await pushOrderToKelola(database, config, orderId);
  const state = await kelolaOrderState(database, config, orderId);
  return state.synced_at
    ? { ok: true, state }
    : { ok: false, error: `Kelola belum menerima order ini: ${state.last_error ?? "order tanpa item"}`, state };
}

/**
 * Cron leg: retry every order Kelola has not accepted inside the window.
 * `now = null` drops the window — the operator's backfill of orders taken
 * before the plugin was on, one batch per call.
 */
export async function drainKelolaOrders(
  database: D1Database,
  config: KelolaConfig,
  now: Date | null = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const since = now ? new Date(now.getTime() - KELOLA_RETRY_WINDOW_HOURS * 3_600_000).toISOString() : "";
  const { results } = await database
    .prepare(
      `SELECT o.id FROM orders o
       LEFT JOIN plugin_kelola_orders k ON k.order_id = o.id
       WHERE k.synced_at IS NULL AND o.shipping_status != 'abandoned'
         AND o.stock_restored_at IS NULL AND o.created_at >= ?
       ORDER BY o.id LIMIT ?`,
    )
    .bind(since, DRAIN_BATCH)
    .all<{ id: number }>();
  let synced = 0;
  for (const { id } of results) {
    if (await pushOrderToKelola(database, config, id, fetcher)) synced += 1;
  }
  return synced;
}

/** An abandoned row younger than this may still convert in place into an order. */
const LEAD_GRACE_MINUTES = 30;

/** Kelola's lead webhook sits beside the order one, behind the same token and secret. */
export function kelolaLeadUrl(orderUrl: string) {
  return orderUrl.replace(/\/order\/([^/]+)$/, "/lead/$1");
}

type LeadRow = {
  id: number;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  province: string;
  city: string;
  district: string;
  total_amount: number;
  source_page_path: string | null;
  product: string | null;
};

/** The body Kelola's `/api/public/toko/lead/:token` validates. */
export function kelolaLeadPayload(lead: LeadRow) {
  return {
    code: lead.order_number,
    customerName: lead.customer_name,
    customerPhone: lead.customer_phone,
    address: lead.address || undefined,
    kecamatan: lead.district || undefined,
    kota: lead.city || undefined,
    provinsi: lead.province || undefined,
    produk: lead.product || undefined,
    nilai: lead.total_amount > 0 ? lead.total_amount : undefined,
    halaman: lead.source_page_path || undefined,
  };
}

/**
 * Cron leg: every abandoned order still abandoned after the grace period goes
 * to Kelola as a lead (not a sale) for CS follow-up. Only success is recorded;
 * a failure is logged and the 24h window bounds the retries.
 */
export async function drainKelolaLeads(
  database: D1Database,
  config: KelolaConfig,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const since = new Date(now.getTime() - KELOLA_RETRY_WINDOW_HOURS * 3_600_000).toISOString();
  const until = new Date(now.getTime() - LEAD_GRACE_MINUTES * 60_000).toISOString();
  const { results } = await database
    .prepare(
      `SELECT o.id, o.order_number, o.customer_name, o.customer_phone, o.address, o.province,
              o.city, o.district, o.total_amount, o.source_page_path,
              (SELECT p.title || CASE WHEN pv.title = p.title THEN '' ELSE ' - ' || pv.title END
               FROM order_items oi
               JOIN product_variants pv ON pv.id = oi.variant_id
               JOIN products p ON p.id = pv.product_id
               WHERE oi.order_id = o.id ORDER BY oi.id LIMIT 1) AS product
       FROM orders o
       LEFT JOIN plugin_kelola_orders k ON k.order_id = o.id
       WHERE o.shipping_status = 'abandoned' AND k.lead_synced_at IS NULL
         AND o.stock_restored_at IS NULL AND o.created_at >= ? AND o.created_at <= ?
       ORDER BY o.id LIMIT ?`,
    )
    .bind(since, until, DRAIN_BATCH)
    .all<LeadRow>();
  const url = kelolaLeadUrl(config.url);
  let synced = 0;
  for (const lead of results) {
    try {
      const body = JSON.stringify(kelolaLeadPayload(lead));
      const timestamp = String(Date.now());
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-timestamp": timestamp,
          "x-signature": await signKelolaBody(config.secret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.error("kelola-lead-push-failed", { orderId: lead.id, status: response.status, body: (await response.text()).slice(0, 300) });
        continue;
      }
      await database
        .prepare(
          `INSERT INTO plugin_kelola_orders (order_id, lead_synced_at) VALUES (?1, ?2)
           ON CONFLICT(order_id) DO UPDATE SET lead_synced_at = ?2`,
        )
        .bind(lead.id, new Date().toISOString())
        .run();
      synced += 1;
    } catch (error) {
      console.error("kelola-lead-push-failed", { orderId: lead.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return synced;
}
