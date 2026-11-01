import type { APIRoute } from "astro";
import { jsonError, jsonOk } from "../../../lib/api.ts";
import {
  defaultCrmTemplates,
  parseCrmTemplates,
} from "../../../lib/crm-template.ts";
import {
  parseEmbedAllowedOrigins,
  resolveEmbedAllowedOrigins,
} from "../../../lib/embed-security.ts";
import { parseHeadlessAllowedOrigins } from "../../../lib/headless-api.ts";
import { isAcceptedSiteProtocol, LOCALE_PATTERN, SUPPORT_EMAIL_PATTERN, THEME_COLOR_PATTERN } from "../../../lib/tenant.ts";
import { getEnvValue, getRuntimeEnv, maskSecretValue } from "../../../lib/env.ts";
import {
  addStorefrontTemplate,
  listStorefrontTemplates,
  resolveStorefrontTemplate,
  validateStorefrontTemplateDefinition,
  type StorefrontTemplateDefinition,
} from "../../../lib/storefront-template.ts";
import {
  AUTOLARIS_CHANNEL_OPTIONS,
  AUTOLARIS_LOCKED_CHANNEL_REASONS,
  AutoLarisClient,
  autoLarisChannelLockReason,
  resolveDisabledAutoLarisChannels,
} from "../../../lib/autolaris-client.ts";
import { MengantarClient } from "../../../lib/mengantar-client.ts";
import {
  getProviderConfig,
  resolveCredentialUpdate,
} from "../../../lib/provider-config.ts";

export const prerender = false;

const DEFAULT_TEST_DESTINATION_ID = "5fc62de8f8f44b34aa4bdc58";
const PHONE_PATTERN = /^\+?\d{9,15}$/;
const CRM_KEYS = ["welcome", "1", "2", "3", "4", "5", "6", "7"] as const;

type SettingsPayload = {
  action?:
    | "save-store"
    | "add-storefront-template"
    | "save-embed-origins"
    | "save-headless-origins"
    | "save-warehouse"
    | "save-crm"
    | "save-integrations"
    | "save-payment-fee-policy"
    | "save-payment-toggles"
    | "save-autolaris-channels"
    | "test-mengantar"
    | "test-autolaris"
    | "test-autolaris-channels";
  is_cod_enabled?: boolean;
  is_autolaris_enabled?: boolean;
  disabled_autolaris_channels?: string[];
  store_name?: string;
  site_url?: string;
  store_description?: string;
  store_tagline?: string;
  store_logo?: string;
  storefront_template?: string;
  storefront_template_definition?: unknown;
  theme_color?: string;
  locale?: string;
  admin_name?: string;
  thanks_whatsapp_redirect?: boolean;
  support_whatsapp?: string;
  support_email?: string;
  business_address?: string;
  embed_allowed_origins?: unknown;
  headless_allowed_origins?: unknown;
  payment_fee_bearer?: "buyer" | "seller";
  cod_fee_bearer?: "buyer" | "seller";
  integrations?: {
    mengantar_api_key?: string | null;
    mengantar_base_url?: string;
    autolaris_api_key?: string | null;
    autolaris_base_url?: string;
  };
  warehouse?: {
    name?: string;
    contact_name?: string;
    contact_phone?: string;
    origin_area_id?: string;
    origin_label?: string;
    pickup_address_id?: string;
    address?: string;
    city?: string;
    province?: string;
  };
  crm_templates?: Record<string, string>;
};

type SettingsRow = {
  store_id: number;
  store_name: string;
  support_whatsapp: string | null;
  support_email?: string | null;
  business_address?: string | null;
  site_url?: string | null;
  description?: string | null;
  tagline?: string | null;
  logo?: string | null;
  storefront_template?: string | null;
  theme_color?: string | null;
  locale?: string | null;
  admin_name?: string | null;
  thanks_whatsapp_redirect?: number | null;
  payment_fee_bearer: string;
  cod_fee_bearer: string;
  is_cod_enabled?: number | null;
  is_autolaris_enabled?: number | null;
  disabled_autolaris_channels?: string | null;
  crm_templates: string | null;
  warehouse_id: number | null;
  warehouse_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  origin_area_id: string | null;
  origin_label: string | null;
  pickup_address_id: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  embed_allowed_origins?: string | null;
  headless_allowed_origins?: string | null;
};
function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePhone(value: unknown) {
  return clean(value, 20).replace(/[\s()-]/g, "");
}

function normalizeHttpUrl(value: unknown) {
  const raw = clean(value, 500).replace(/\/+$/, "");
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString().replace(/\/$/, "")
      : "";
  } catch {
    return "";
  }
}


function normalizeTemplates(value: Record<string, string> | undefined) {
  return Object.fromEntries(
    CRM_KEYS.map((key) => [
      key,
      clean(value?.[key], 1200) || defaultCrmTemplates[key],
    ]),
  );
}

async function getSettingsRow(database: D1Database) {
  try {
    return (await database
      .prepare(
        `
      SELECT
        s.id AS store_id,
        s.name AS store_name,
        s.support_whatsapp,
        s.support_email,
        s.business_address,
        s.site_url,
        s.description,
        s.tagline,
        s.logo,
        s.storefront_template,
        s.theme_color,
        s.locale,
        s.admin_name,
        s.thanks_whatsapp_redirect,
        s.payment_fee_bearer,
        s.cod_fee_bearer,
        s.is_cod_enabled,
        s.is_autolaris_enabled,
        s.disabled_autolaris_channels,
        s.crm_templates,
        s.embed_allowed_origins,
        s.headless_allowed_origins,
        w.id AS warehouse_id,
        w.name AS warehouse_name,
        w.contact_name,
        w.contact_phone,
        w.origin_area_id,
        w.origin_label,
        w.pickup_address_id,
        w.address,
        w.city,
        w.province
      FROM stores s
      LEFT JOIN warehouses w ON w.store_id = s.id
      ORDER BY s.id, w.is_primary DESC, w.id
      LIMIT 1
    `,
      )
      .first()) as SettingsRow | null;
  } catch {
    return (await database
      .prepare(
        `
      SELECT
        s.id AS store_id,
        s.name AS store_name,
        s.support_whatsapp,
        NULL AS support_email,
        NULL AS business_address,
        s.site_url,
        s.description,
        s.tagline,
        s.logo,
        s.storefront_template,
        s.theme_color,
        s.locale,
        s.admin_name,
        0 AS thanks_whatsapp_redirect,
        s.payment_fee_bearer,
        s.cod_fee_bearer,
        1 AS is_cod_enabled,
        1 AS is_autolaris_enabled,
        '' AS disabled_autolaris_channels,
        s.crm_templates,
        w.id AS warehouse_id,
        w.name AS warehouse_name,
        w.contact_name,
        w.contact_phone,
        w.origin_area_id,
        w.origin_label,
        w.pickup_address_id,
        w.address,
        w.city,
        w.province
      FROM stores s
      LEFT JOIN warehouses w ON w.store_id = s.id
      -- A schema this old predates is_primary; its first row is the primary.
      ORDER BY s.id, w.id
      LIMIT 1
    `,
      )
      .first()) as SettingsRow | null;
  }
}

async function credentialStatus(database: D1Database, locals: App.Locals) {
  const config = await getProviderConfig(database, locals);

  return {
    mengantar: {
      configured: Boolean(config.mengantar.apiKey),
      api_key_masked: maskSecretValue(config.mengantar.apiKey),
      base_url: config.mengantar.baseUrl,
      source: config.mengantar.source,
    },
    autolaris: {
      configured: Boolean(config.autolaris.apiKey),
      api_key_configured: Boolean(config.autolaris.apiKey),
      api_key_masked: maskSecretValue(config.autolaris.apiKey),
      base_url: config.autolaris.baseUrl,
      source: config.autolaris.source,
    },
  };
}

export const GET: APIRoute = async ({ locals }) => {
  const runtime = getRuntimeEnv(locals);
  const database = runtime?.OMS_DB;
  if (!database || typeof database !== "object") {
    return jsonError("Database pengaturan belum tersedia.", 503);
  }

  try {
    const row = await getSettingsRow(database as D1Database);
    if (!row) return jsonError("Store belum tersedia.", 404);
    const embedOriginPolicy = resolveEmbedAllowedOrigins(
      row.embed_allowed_origins,
      getEnvValue("PUBLIC_EMBED_ALLOWED_ORIGINS", runtime),
    );

    const templateList = await listStorefrontTemplates(
      database as D1Database,
      row.store_id,
    );
    return jsonOk({
      data: {
        credentials: await credentialStatus(database as D1Database, locals),
        store: {
          name: row.store_name,
          support_whatsapp: row.support_whatsapp ?? "",
          support_email: row.support_email ?? "",
          business_address: row.business_address ?? "",
          site_url: row.site_url ?? "",
          description: row.description ?? "",
          tagline: row.tagline ?? "",
          logo: row.logo ?? "",
          storefront_template: row.storefront_template ?? "compact-market",
          theme_color: row.theme_color ?? "",
          locale: row.locale ?? "",
          admin_name: row.admin_name ?? "",
          thanks_whatsapp_redirect: Number(row.thanks_whatsapp_redirect) === 1,
          storefront_templates: templateList.templates,
          storefront_templates_available: templateList.state === "ready",
          payment_fee_bearer:
            row.payment_fee_bearer === "seller" ? "seller" : "buyer",
          cod_fee_bearer:
            row.cod_fee_bearer === "seller" ? "seller" : "buyer",
          is_cod_enabled: row.is_cod_enabled !== 0,
          is_autolaris_enabled: row.is_autolaris_enabled !== 0,
          disabled_autolaris_channels: resolveDisabledAutoLarisChannels(
            row.disabled_autolaris_channels,
          ),
          locked_autolaris_channels: AUTOLARIS_LOCKED_CHANNEL_REASONS,
          embed_allowed_origins: embedOriginPolicy.valid
            ? embedOriginPolicy.origins
            : [],
          headless_allowed_origins: parseHeadlessAllowedOrigins(
            row.headless_allowed_origins ?? [],
          ).patterns,
        },
        warehouse: row.warehouse_id
          ? {
              id: row.warehouse_id,
              name: row.warehouse_name ?? "",
              contact_name: row.contact_name ?? "",
              contact_phone: row.contact_phone ?? "",
              origin_area_id: row.origin_area_id ?? "",
              origin_label: row.origin_label ?? "",
              pickup_address_id: row.pickup_address_id ?? "",
              address: row.address ?? "",
              city: row.city ?? "",
              province: row.province ?? "",
            }
          : null,
        crm_templates: parseCrmTemplates(row.crm_templates),
      },
    });
  } catch (error) {
    console.error("settings-get", error);
    return jsonError("Gagal mengambil pengaturan store.", 500);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    return jsonError("Database pengaturan belum tersedia.", 503);
  }

  const body = (await request
    .json()
    .catch(() => null)) as SettingsPayload | null;
  if (!body) return jsonError("Payload tidak valid.", 400);

  try {
    const db = database as D1Database;
    if (body.action === "save-integrations" && locals.admin?.role !== "owner") {
      return jsonError("Hanya owner yang dapat mengubah endpoint dan kredensial provider.", 403);
    }
    const providerConfig = await getProviderConfig(db, locals);
    if (body.action === "test-mengantar") {
      const { apiKey, baseUrl } = providerConfig.mengantar;
      if (!apiKey)
        return jsonError("API Key Mengantar belum dikonfigurasi.", 400, {
          message: "API Key Mengantar belum dikonfigurasi.",
        });

      const current = await getSettingsRow(db);
      const originId = current?.origin_area_id || "";
      if (!originId)
        return jsonError("Origin area gudang belum dikonfigurasi.", 400, {
          message: "Origin area gudang belum dikonfigurasi.",
        });

      try {
        const rates = await new MengantarClient(apiKey, baseUrl).estimateRates({
          originId,
          destinationId: DEFAULT_TEST_DESTINATION_ID,
          weight: 1,
        });
        if (rates.length === 0) {
          return jsonError(
            "Koneksi Mengantar aktif tetapi tidak mengembalikan estimasi layanan.",
            502,
            {
              message:
                "Koneksi Mengantar aktif tetapi tidak mengembalikan estimasi layanan.",
              verified: false,
            },
          );
        }

        return jsonOk({
          verified: true,
          couriers_found: rates.length,
          message: `Koneksi Mengantar aktif: ${rates.length} layanan ditemukan.`,
        });
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Koneksi Mengantar gagal.";
        return jsonError(message, message.includes("timeout") ? 504 : 502, {
          message,
          verified: false,
        });
      }
    }

    if (body.action === "test-autolaris") {
      const { apiKey, baseUrl } = providerConfig.autolaris;
      if (!apiKey) {
        return jsonError("API Key AutoLaris belum dikonfigurasi.", 400, {
          configured: false,
          verified: false,
          verification_supported: false,
          message: "API Key AutoLaris belum dikonfigurasi.",
        });
      }

      const health = await new AutoLarisClient(
        apiKey,
        baseUrl,
      ).verifyCredentials();
      return jsonOk({
        configured: true,
        verified: health.verified,
        verification_supported: health.verificationSupported,
        base_url: baseUrl,
        message: health.message,
      });
    }

    const current = await getSettingsRow(db);
    if (!current) return jsonError("Store belum tersedia.", 404);

    if (body.action === "save-embed-origins") {
      const policy = parseEmbedAllowedOrigins(body.embed_allowed_origins);
      if (!policy.valid) {
        return jsonError(
          "Origin embed harus berupa origin HTTPS lengkap tanpa path, query, fragment, kredensial, atau wildcard. Maksimal 25 origin.",
          400,
        );
      }
      await db
        .prepare(
          "UPDATE stores SET embed_allowed_origins = ? WHERE id = ?",
        )
        .bind(policy.origins.join(","), current.store_id)
        .run();
      return jsonOk({
        message: "Daftar origin embed berhasil disimpan.",
        data: { embed_allowed_origins: policy.origins },
      });
    }
    if (body.action === "save-headless-origins") {
      const policy = parseHeadlessAllowedOrigins(body.headless_allowed_origins);
      if (!policy.valid) {
        return jsonError(
          "Origin Headless API harus berupa domain, origin HTTP(S), atau wildcard subdomain yang valid. Wildcard global, path, query, fragment, dan kredensial tidak diizinkan. Maksimal 25 pola.",
          400,
        );
      }
      await db
        .prepare(
          "UPDATE stores SET headless_allowed_origins = ? WHERE id = ?",
        )
        .bind(policy.patterns.join(","), current.store_id)
        .run();
      return jsonOk({
        message: "Allowlist origin Headless API berhasil disimpan.",
        data: { headless_allowed_origins: policy.patterns },
      });
    }


    if (body.action === "save-payment-fee-policy") {
      if (
        (body.payment_fee_bearer !== "buyer" &&
          body.payment_fee_bearer !== "seller") ||
        (body.cod_fee_bearer !== "buyer" &&
          body.cod_fee_bearer !== "seller")
      ) {
        return jsonError("Penanggung biaya admin tidak valid.", 400);
      }
      await db
        .prepare(
          "UPDATE stores SET payment_fee_bearer = ?, cod_fee_bearer = ? WHERE id = ?",
        )
        .bind(
          body.payment_fee_bearer,
          body.cod_fee_bearer,
          current.store_id,
        )
        .run();
      return jsonOk({
        message: "Kebijakan biaya pembayaran berhasil disimpan.",
        data: {
          payment_fee_bearer: body.payment_fee_bearer,
          cod_fee_bearer: body.cod_fee_bearer,
        },
      });
    }
    if (body.action === "save-payment-toggles") {
      if (
        typeof body.is_cod_enabled !== "boolean" ||
        typeof body.is_autolaris_enabled !== "boolean"
      ) {
        return jsonError("Status metode pembayaran harus berupa boolean.", 400);
      }
      const isCodEnabled = body.is_cod_enabled ? 1 : 0;
      const isAutoLarisEnabled = body.is_autolaris_enabled ? 1 : 0;
      
      await db
        .prepare(
          "UPDATE stores SET is_cod_enabled = ?, is_autolaris_enabled = ? WHERE id = ?",
        )
        .bind(isCodEnabled, isAutoLarisEnabled, current.store_id)
        .run();

      return jsonOk({
        message: "Status metode pembayaran berhasil diperbarui.",
        data: {
          is_cod_enabled: isCodEnabled === 1,
          is_autolaris_enabled: isAutoLarisEnabled === 1,
        },
      });
    }
    if (body.action === "save-autolaris-channels") {
      const disabledList = resolveDisabledAutoLarisChannels(
        body.disabled_autolaris_channels,
      );
      const disabledStr = disabledList.join(",");

      await db
        .prepare(
          "UPDATE stores SET disabled_autolaris_channels = ? WHERE id = ?",
        )
        .bind(disabledStr, current.store_id)
        .run();

      return jsonOk({
        message: "Status channel AutoLaris berhasil diperbarui.",
        data: {
          disabled_autolaris_channels: disabledList,
        },
      });
    }

    if (body.action === "test-autolaris-channels") {
      const { apiKey, baseUrl } = providerConfig.autolaris;
      const isAutoLarisMaster = current.is_autolaris_enabled !== 0;
      const disabledList = resolveDisabledAutoLarisChannels(
        current.disabled_autolaris_channels,
      );

      let isApiVerified = false;
      let isVerificationSupported = false;
      let verificationMessage = "";

      if (apiKey) {
        const health = await new AutoLarisClient(
          apiKey,
          baseUrl,
        ).verifyCredentials();
        isApiVerified = health.verified;
        isVerificationSupported = health.verificationSupported;
        verificationMessage = health.message;
      } else {
        verificationMessage = "API Key AutoLaris belum diisi.";
      }

      const results = AUTOLARIS_CHANNEL_OPTIONS.map((ch) => {
        const lockReason = autoLarisChannelLockReason(ch.code);
        const isStoreDisabled =
          disabledList.includes(ch.code) || !isAutoLarisMaster;
        const isConfigured = Boolean(apiKey);
        const isLocallyActive = isConfigured && !isStoreDisabled && !lockReason;
        let status = "ready";
        let message = "Channel aktif & siap digunakan di checkout.";

        if (lockReason) {
          status = "locked_by_provider";
          message = lockReason;
        } else if (!isConfigured) {
          status = "unconfigured";
          message = "API Key AutoLaris belum diisi (Disembunyikan dari checkout).";
        } else if (isStoreDisabled) {
          status = "disabled_by_store";
          message = "Dinonaktifkan oleh toko (Disembunyikan dari checkout).";
        } else if (!isApiVerified) {
          status = "configured_unverified";
          message = verificationMessage;
        }

        return {
          code: ch.code,
          name: ch.label,
          status,
          is_active: isLocallyActive,
          message,
        };
      });

      return jsonOk({
        message: isApiVerified
          ? "Pemeriksaan selesai: Kredensial terverifikasi aktif oleh server AutoLaris."
          : `Pemeriksaan konfigurasi selesai: ${verificationMessage}`,
        data: {
          api_key_configured: Boolean(apiKey),
          api_key_verified: isApiVerified,
          api_key_verification_supported: isVerificationSupported,
          master_enabled: isAutoLarisMaster,
          channels: results,
        },
      });
    }

    if (body.action === "save-integrations") {
      const mengantarKey = resolveCredentialUpdate(
        body.integrations?.mengantar_api_key,
      );
      const autolarisKey = resolveCredentialUpdate(
        body.integrations?.autolaris_api_key,
      );
      const mengantarApiKey = clean(mengantarKey.value, 1000);
      const autolarisApiKey = clean(autolarisKey.value, 1000);
      const mengantarBaseUrl = normalizeHttpUrl(
        body.integrations?.mengantar_base_url,
      );
      const autolarisBaseUrl = normalizeHttpUrl(
        body.integrations?.autolaris_base_url,
      );
      if (!mengantarBaseUrl || !autolarisBaseUrl) {
        return jsonError(
          "Base URL Mengantar dan AutoLaris harus berupa URL HTTP(S) yang valid.",
          400,
        );
      }

      await db
        .prepare(
          `
        UPDATE stores
        SET mengantar_api_key = CASE WHEN ? = 1 THEN NULL
              ELSE COALESCE(NULLIF(?, ''), mengantar_api_key) END,
            mengantar_base_url = ?,
            autolaris_api_key = CASE WHEN ? = 1 THEN NULL
              ELSE COALESCE(NULLIF(?, ''), autolaris_api_key) END,
            autolaris_base_url = ?
        WHERE id = ?
      `,
        )
        .bind(
          mengantarKey.clear ? 1 : 0,
          mengantarApiKey,
          mengantarBaseUrl,
          autolarisKey.clear ? 1 : 0,
          autolarisApiKey,
          autolarisBaseUrl,
          current.store_id,
        )
        .run();

      return jsonOk({
        message: "Konfigurasi API Mengantar dan AutoLaris berhasil disimpan.",
        data: { credentials: await credentialStatus(db, locals) },
      });
    }

    if (body.action === "add-storefront-template") {
      let definition: StorefrontTemplateDefinition;
      try {
        definition = validateStorefrontTemplateDefinition(
          body.storefront_template_definition,
        );
      } catch {
        return jsonError(
          "Definisi template tidak valid. Periksa ID, nama, layout, dan bagian yang dipilih.",
          400,
        );
      }
      try {
        await addStorefrontTemplate(db, current.store_id, definition);
      } catch (error) {
        if (
          error instanceof Error &&
          /unique constraint failed/i.test(error.message)
        ) {
          return jsonError("ID template sudah digunakan.", 409);
        }
        throw error;
      }
      const templateList = await listStorefrontTemplates(db, current.store_id);
      if (templateList.state !== "ready") {
        return jsonError(
          "Template tersimpan, tetapi daftar template belum dapat dibaca.",
          503,
        );
      }
      return jsonOk({
        message: "Template storefront berhasil ditambahkan.",
        data: { storefront_templates: templateList.templates },
      });
    }

    if (body.action === "save-store") {
      const storeName = clean(body.store_name, 120);
      if (!storeName) return jsonError("Nama store wajib diisi.", 400);
      // support_whatsapp is no longer written here: Pengaturan → Nomor WhatsApp
      // owns it through src/lib/whatsapp-numbers.ts (PRD A35), which keeps it
      // on the first active number. Writing it from this form too would let
      // a stale field overwrite the list's choice.
      // Identity beyond the name became editable when it moved into D1
      // (ADR-003). Before that these were baked into the bundle, so the only
      // way to change a store's address or tagline was a rebuild.
      const siteUrlRaw = clean(body.site_url, 200);
      let siteUrl = "";
      if (siteUrlRaw) {
        try {
          const parsed = new URL(siteUrlRaw);
          if (!isAcceptedSiteProtocol(parsed)) {
            return jsonError("Alamat toko harus memakai https.", 400);
          }
          siteUrl = parsed.origin;
        } catch {
          return jsonError(
            "Alamat toko tidak valid. Contoh: https://tokosaya.com",
            400,
          );
        }
      }

      const storefrontTemplate =
        clean(body.storefront_template, 40) || "compact-market";
      const templateResolution = await resolveStorefrontTemplate(
        db,
        storefrontTemplate,
      );
      if (templateResolution.state === "unavailable") {
        return jsonError("Konfigurasi template belum dapat dibaca.", 503);
      }
      if (templateResolution.state !== "ready") {
        return jsonError("Template storefront tidak dikenal.", 400);
      }

      // A blank field clears the column back to NULL, which the resolver reads
      // as "not configured here" and falls back for — the same meaning it has
      // on a fresh install, so clearing is a real action rather than a way to
      // store an empty name.
      // Stored per install and rendered ever since — `<meta name="theme-color">`,
      // `<html lang>`, JSON-LD `inLanguage`, the admin title — with no way for an
      // operator to set them. Rejected rather than silently corrected:
      // `resolveTenantConfig` falls back for a malformed value, so saving `#fff`
      // and being shown `#111111` would tell the operator nothing about why.
      const themeColorValue = clean(body.theme_color, 7);
      if (themeColorValue && !THEME_COLOR_PATTERN.test(themeColorValue)) {
        return jsonError(
          "Warna tema harus berformat heksadesimal enam digit, contoh: #111111.",
          400,
        );
      }
      const localeValue = clean(body.locale, 10);
      if (localeValue && !LOCALE_PATTERN.test(localeValue)) {
        return jsonError(
          "Locale harus berformat bahasa atau bahasa-NEGARA, contoh: id-ID.",
          400,
        );
      }

      // Public contact for the storefront's legal pages. The address is free
      // text; the email is checked for shape only, never sent to.
      const supportEmail = clean(body.support_email, 160).toLowerCase();
      if (supportEmail && !SUPPORT_EMAIL_PATTERN.test(supportEmail)) {
        return jsonError("Email customer service tidak valid. Contoh: cs@tokosaya.com", 400);
      }
      const businessAddress = clean(body.business_address, 300);

      await db
        .prepare(
          `UPDATE stores
              SET name = ?, site_url = ?, description = ?,
                  tagline = ?, logo = ?, storefront_template = ?,
                  theme_color = ?, locale = ?, admin_name = ?,
                  thanks_whatsapp_redirect = ?, support_email = ?, business_address = ?
            WHERE id = ?`,
        )
        .bind(
          storeName,
          siteUrl || null,
          clean(body.store_description, 300) || null,
          clean(body.store_tagline, 120) || null,
          clean(body.store_logo, 300) || null,
          storefrontTemplate || null,
          themeColorValue || null,
          localeValue || null,
          clean(body.admin_name, 120) || null,
          body.thanks_whatsapp_redirect === true ? 1 : 0,
          supportEmail || null,
          businessAddress || null,
          current.store_id,
        )
        .run();
      return jsonOk({
        message: "Profil store dan identitas storefront berhasil disimpan.",
      });
    }

    if (body.action === "save-warehouse") {
      const warehouseName = clean(body.warehouse?.name, 120);
      const contactName = clean(body.warehouse?.contact_name, 120);
      const contactPhone = normalizePhone(body.warehouse?.contact_phone);
      const originAreaId = clean(body.warehouse?.origin_area_id, 120);
      const originLabel = clean(body.warehouse?.origin_label, 300);
      const pickupAddressId = clean(body.warehouse?.pickup_address_id, 120);
      const address = clean(body.warehouse?.address, 500);
      const city = clean(body.warehouse?.city, 120);
      const province = clean(body.warehouse?.province, 120);
      if (
        !warehouseName ||
        !contactName ||
        !originAreaId ||
        !address ||
        !city ||
        !province
      ) {
        return jsonError("Lengkapi seluruh data gudang wajib.", 400);
      }
      if (!PHONE_PATTERN.test(contactPhone))
        return jsonError("Telepon PIC harus berisi 9-15 digit.", 400);

      let resolvedPickupAddressId = pickupAddressId || "";
      if (providerConfig.mengantar.apiKey) {
        try {
          resolvedPickupAddressId = await new MengantarClient(
            providerConfig.mengantar.apiKey,
            providerConfig.mengantar.baseUrl,
          ).ensurePickupAddress({
            addressId: pickupAddressId || undefined,
            pickupName: warehouseName,
            pickupPic: contactName,
            pickupPicPhone: contactPhone,
            pickupAddress: address,
            pickupAutofill: originAreaId,
          });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Sinkronisasi pickup address Mengantar gagal.";
          return jsonError(
            `${message} Data gudang lokal tidak diubah.`,
            message.includes("timeout") ? 504 : 502,
          );
        }
      }

      if (current.warehouse_id) {
        await db
          .prepare(
            `
          UPDATE warehouses
          SET name = ?, contact_name = ?, contact_phone = ?, origin_area_id = ?, origin_label = ?, pickup_address_id = ?, address = ?, city = ?, province = ?
          WHERE id = ?
        `,
          )
          .bind(
            warehouseName,
            contactName,
            contactPhone,
            originAreaId,
            originLabel,
            resolvedPickupAddressId,
            address,
            city,
            province,
            current.warehouse_id,
          )
          .run();
      } else {
        await db
          .prepare(
            `
          INSERT INTO warehouses (
            store_id, name, contact_name, contact_phone, origin_area_id,
            origin_label, pickup_address_id, address, city, province, is_primary
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `,
          )
          .bind(
            current.store_id,
            warehouseName,
            contactName,
            contactPhone,
            originAreaId,
            originLabel,
            resolvedPickupAddressId,
            address,
            city,
            province,
          )
          .run();
      }

      const created = !current.warehouse_id;
      return jsonOk({
        message:
          resolvedPickupAddressId !== pickupAddressId
            ? "Alamat pickup dibuat atau dipulihkan di Mengantar dan konfigurasi gudang berhasil disimpan."
            : created
              ? "Gudang berhasil dibuat."
              : "Konfigurasi gudang berhasil disimpan.",
        data: { pickup_address_id: resolvedPickupAddressId },
      });
    }

    if (body.action === "save-crm") {
      const templates = normalizeTemplates(body.crm_templates);
      await db
        .prepare("UPDATE stores SET crm_templates = ? WHERE id = ?")
        .bind(JSON.stringify(templates), current.store_id)
        .run();
      return jsonOk({
        message: "Template CRM Welcome dan follow-up 1–7 berhasil disimpan.",
      });
    }

    return jsonError("Action tidak dikenal.", 400);
  } catch (error) {
    console.error("settings-put", error);
    return jsonError("Gagal memperbarui pengaturan store.", 500);
  }
};
export const POST = PUT;
