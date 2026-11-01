import type { APIRoute } from "astro";
import { jsonError, jsonOk } from "../../../../lib/api.ts";
import { getRuntimeEnv } from "../../../../lib/env.ts";
import { pluginContext, savePluginSettings, type PluginContext } from "../../../../plugins/registry.ts";
import {
  drainKelolaOrders,
  getKelolaConfig,
  kelolaSyncStatus,
  maskKelolaWebhookUrl,
  normalizeKelolaWebhookUrl,
  testKelolaConnection,
} from "../../../../plugins/kelola/sync.ts";

export const prerender = false;

type Payload = {
  action?: "save" | "test" | "backfill";
  /** null clears the stored pair and falls back to the env pair. */
  webhook_url?: string | null;
  /** Empty keeps the stored secret. */
  webhook_secret?: string;
};

/** The secret never leaves the server; the URL token is masked. */
async function status(context: PluginContext) {
  const config = getKelolaConfig(context.settings, context.env);
  return {
    configured: Boolean(config),
    source: config?.source ?? "none",
    webhook_url_masked: config ? maskKelolaWebhookUrl(config.url) : "",
    sync: config ? await kelolaSyncStatus(context.database) : null,
  };
}

async function activeContext(locals: App.Locals) {
  const db = getRuntimeEnv(locals)?.OMS_DB;
  if (!db || typeof db !== "object") return null;
  return pluginContext(db as D1Database, getRuntimeEnv(locals), "kelola");
}

export const GET: APIRoute = async ({ locals }) => {
  const context = await activeContext(locals);
  if (!context) return jsonError("Plugin Kelola CRM belum aktif.", 409);
  return jsonOk({ data: { kelola: await status(context) } });
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const context = await activeContext(locals);
  if (!context) return jsonError("Plugin Kelola CRM belum aktif.", 409);
  const body = (await request.json().catch(() => null)) as Payload | null;
  if (!body) return jsonError("Payload tidak valid.", 400);

  if (body.action === "test") {
    const config = getKelolaConfig(context.settings, context.env);
    if (!config) return jsonError("Kelola CRM belum dihubungkan.", 400);
    const result = await testKelolaConnection(config);
    return result.ok
      ? jsonOk({ verified: true, message: result.message })
      : jsonError(result.message, 502, { verified: false });
  }
  if (body.action === "backfill") {
    const config = getKelolaConfig(context.settings, context.env);
    if (!config) return jsonError("Kelola CRM belum dihubungkan.", 400);
    const synced = await drainKelolaOrders(context.database, config, null);
    const kelola = await status(context);
    const left = kelola.sync?.unsynced_older ?? 0;
    return jsonOk({
      message: `${synced} order lama terkirim ke Kelola.${left ? ` ${left} masih tertunda: klik lagi, atau lihat galatnya di detail order.` : ""}`,
      data: { kelola, verified: left === 0 },
    });
  }
  if (body.action !== "save") return jsonError("Aksi tidak valid.", 400);
  if (locals.admin?.role !== "owner") {
    return jsonError("Hanya owner yang dapat mengubah endpoint dan kredensial provider.", 403);
  }

  if (body.webhook_url === null) {
    await savePluginSettings(context.database, "kelola", {});
    context.settings = {};
    return jsonOk({ message: "Sambungan Kelola dari dashboard dihapus.", data: { kelola: await status(context) } });
  }
  const url = normalizeKelolaWebhookUrl(body.webhook_url);
  if (!url) return jsonError("URL webhook harus URL HTTPS dari Kelola, berakhiran /api/public/toko/order/<token>.", 400);
  const stored = typeof context.settings.webhook_secret === "string" ? context.settings.webhook_secret : "";
  const secret = (typeof body.webhook_secret === "string" ? body.webhook_secret.trim().slice(0, 200) : "") || stored.trim();
  if (secret.length < 16) return jsonError("Secret webhook Kelola wajib diisi.", 400);

  context.settings = { webhook_url: url, webhook_secret: secret };
  await savePluginSettings(context.database, "kelola", context.settings);
  const check = await testKelolaConnection({ url, secret });
  return jsonOk({
    message: check.ok ? `Tersimpan. ${check.message}` : `Tersimpan, tetapi tes koneksi gagal: ${check.message}`,
    data: { kelola: await status(context), verified: check.ok },
  });
};
