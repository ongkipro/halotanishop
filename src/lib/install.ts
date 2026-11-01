import {
  hashAdminPassword,
  normalizeAdminUsername,
  validateAdminUsername,
  validateNewAdminPassword,
} from "./admin-credentials.ts";
import { STOREFRONT_TEMPLATE_IDS } from "./tenant-contract.ts";
import { normalizeWhatsappPhone } from "./whatsapp-numbers.ts";
import { isAcceptedSiteProtocol } from "./tenant.ts";

export interface InstallInput {
  storeName: unknown;
  siteUrl: unknown;
  adminUsername: unknown;
  adminPassword: unknown;
  adminPasswordConfirm: unknown;
  tagline?: unknown;
  supportWhatsapp: unknown;
  locale?: unknown;
  storefrontTemplate?: unknown;
}

export interface InstallPlan {
  storeName: string;
  siteUrl: string;
  slug: string;
  adminUsername: string;
  adminPassword: string;
  tagline: string;
  supportWhatsapp: string;
  locale: string;
  storefrontTemplate: string;
}

/**
 * The provider-neutral courier catalogue shown to a new operator. Availability
 * still depends on the live quote returned for the configured warehouse and
 * destination; these rows only let the operator explicitly narrow that result.
 * Paxel COD stays off because that was the existing product policy before the
 * demo seed that carried these rows was removed.
 *
 * Only JNE and J&T start enabled: the two couriers with the widest COD reach
 * in the fleet's traffic, so a new store offers a short, reliable choice and
 * the operator switches the others on in /admin/expeditions. Every courier
 * still gets a row, so turning one on is a toggle, not a missing entry.
 *
 * Ninja is not in this list: Mengantar discontinued it from its public API on
 * 2026-09-01, and migration `0061` removes the rule from existing stores.
 *
 * SPX (Shopee Express) appeared in the live `/order/estimate?courier=all`
 * result as `spx` on 2026-09-25, before Mengantar's documentation listed it;
 * Mengantar confirmed it for create-order. Migration `0059` adds it to
 * existing stores.
 */
export const DEFAULT_COURIER_RULES = [
  { code: "JNE", enabled: 1, cod: 1 },
  { code: "SiCepat", enabled: 0, cod: 1 },
  { code: "J&T", enabled: 1, cod: 1 },
  { code: "SAP", enabled: 0, cod: 1 },
  { code: "Anteraja", enabled: 0, cod: 1 },
  { code: "Lion", enabled: 0, cod: 1 },
  { code: "IDexpress", enabled: 0, cod: 1 },
  { code: "Paxel", enabled: 0, cod: 0 },
  { code: "Pos", enabled: 0, cod: 1 },
  { code: "SPX", enabled: 0, cod: 1 },
] as const;

const defaultCourierValues = DEFAULT_COURIER_RULES.map(
  (rule) => `('${rule.code.replace("'", "''")}', ${rule.enabled}, ${rule.cod})`,
).join(",\n");

const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Derives a URL-safe slug from the store name. It is diagnostic only — nothing
 * routes on it — so a name that reduces to nothing falls back rather than
 * failing the install and stranding the operator on a form.
 */
export function slugFromStoreName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "adsbook";
}

/**
 * Validates everything before a single row is written. The install must be
 * all-or-nothing: a half-installed store — identity saved but the credential
 * still the default, or the reverse — is worse than one that refused, because
 * the operator cannot tell which half took.
 */
export function planInstall(
  input: InstallInput,
): { ok: true; plan: InstallPlan } | { ok: false; error: string } {
  const storeName = text(input.storeName, 120);
  if (storeName.length < 2) {
    return { ok: false, error: "Nama toko wajib diisi, minimal 2 karakter." };
  }

  const siteUrlRaw = text(input.siteUrl, 200);
  let siteUrl = "";
  try {
    const parsed = new URL(siteUrlRaw);
    if (!isAcceptedSiteProtocol(parsed)) {
      return { ok: false, error: "Alamat toko harus memakai https." };
    }
    siteUrl = parsed.origin;
  } catch {
    return {
      ok: false,
      error: "Alamat toko tidak valid. Contoh: https://tokosaya.com",
    };
  }

  const adminUsername = normalizeAdminUsername(input.adminUsername);
  if (!validateAdminUsername(adminUsername)) {
    return {
      ok: false,
      error:
        "Username admin harus 3–64 karakter, hanya huruf kecil, angka, titik, garis bawah, atau strip.",
    };
  }

  const adminPassword =
    typeof input.adminPassword === "string" ? input.adminPassword : "";
  const passwordError = validateNewAdminPassword(adminPassword, adminUsername);
  if (passwordError) return { ok: false, error: passwordError };

  if (adminPassword !== input.adminPasswordConfirm) {
    return { ok: false, error: "Konfirmasi password tidak cocok." };
  }

  const supportWhatsapp = text(input.supportWhatsapp, 20).replace(/\D/g, "");
  if (supportWhatsapp && (supportWhatsapp.length < 9 || supportWhatsapp.length > 15)) {
    return { ok: false, error: "Nomor WhatsApp harus berisi 9–15 digit." };
  }

  const locale = text(input.locale, 10) || "id-ID";
  if (!LOCALE_PATTERN.test(locale)) {
    return { ok: false, error: "Format bahasa tidak valid. Contoh: id-ID" };
  }

  const storefrontTemplate = text(input.storefrontTemplate, 40) || "compact-market";
  if (!(STOREFRONT_TEMPLATE_IDS as readonly string[]).includes(storefrontTemplate)) {
    return { ok: false, error: "Template storefront tidak dikenal." };
  }

  return {
    ok: true,
    plan: {
      storeName,
      siteUrl,
      slug: slugFromStoreName(storeName),
      tagline: text(input.tagline, 120),
      adminUsername,
      adminPassword,
      supportWhatsapp,
      locale,
      storefrontTemplate,
    },
  };
}

/**
 * Writes the install. All statements go through `batch()` so the store row,
 * credential, and default courier catalogue land together or not at all — the half-installed state this
 * guards against is the one an operator cannot diagnose.
 *
 * The store and credential statements are guarded, and that is not belt-and-braces. Guarding only
 * the store insert left the credential UPDATE unconditional: a zero-row insert
 * is not an error, so D1 kept the batch, the second submission was told
 * "already installed" — and had nonetheless just replaced the operator's
 * username and password with its own. Anyone polling an un-installed Worker
 * would own the store the moment its real operator installed it, because
 * `hashAdminPassword` parks every request in ~100 ms of PBKDF2 before the write.
 *
 * The credential guard is `must_change_password = 1`: only the seeded, never-
 * configured credential may be claimed, and it may be claimed once. That
 * predicate is unaffected by the store insert, so it holds whatever order the
 * batch runs in — a property `NOT EXISTS (SELECT 1 FROM stores)` would lose the
 * moment the insert landed first.
 */
export async function runInstall(
  database: D1Database,
  plan: InstallPlan,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const passwordHash = await hashAdminPassword(plan.adminPassword);
  const now = new Date().toISOString();

  // Without a seeded credential row the UPDATE would match nothing while the
  // store insert succeeded, leaving an install with no admin account and no
  // wizard to make one. Checked here so the operator is told which of the two
  // things went wrong.
  const seat = await database
    .prepare("SELECT COUNT(*) AS total FROM admin_credentials")
    .first<{ total: number }>();
  if (!seat?.total) {
    console.error("install-no-credential-row");
    return {
      ok: false,
      error:
        "Tabel admin_credentials kosong, jadi tidak ada akun admin yang bisa dipakai. Jalankan ulang migrasi database sebelum memasang.",
    };
  }

  const installPhone = normalizeWhatsappPhone(plan.supportWhatsapp);
  try {
    const [storeResult, credentialResult] = await database.batch([
      database
        .prepare(
          `INSERT INTO stores (name, slug, site_url, tagline, locale, storefront_template, admin_name, support_whatsapp, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM stores)`,
        )
        .bind(
          plan.storeName,
          plan.slug,
          plan.siteUrl,
          plan.tagline || null,
          plan.locale,
          plan.storefrontTemplate,
          `${plan.storeName} Ops`,
          plan.supportWhatsapp || null,
          now,
        ),
      database
        .prepare(
          `UPDATE admin_credentials
             SET username = ?, password_hash = ?, must_change_password = 0, updated_at = ?
           WHERE id = (SELECT MIN(id) FROM admin_credentials)
             AND must_change_password = 1`,
        )
        .bind(plan.adminUsername, passwordHash, now),
      database
        .prepare(
          `INSERT INTO courier_rules (
             store_id, courier_code, is_enabled, is_cod_enabled, excluded_provinces
           )
           WITH defaults(courier_code, is_enabled, is_cod_enabled) AS (
             VALUES ${defaultCourierValues}
           )
           SELECT store.id, defaults.courier_code, defaults.is_enabled,
                  defaults.is_cod_enabled, NULL
           FROM stores AS store
           CROSS JOIN defaults
           WHERE store.slug = ?
             AND NOT EXISTS (
               SELECT 1 FROM courier_rules WHERE store_id = store.id
             )`,
        )
        .bind(plan.slug),
      // The rotator's list starts with the number the installer was given
      // (PRD A35); an install without a usable one starts empty and /thanks
      // hides its WhatsApp button until a number is added.
      database
        .prepare(
          `INSERT INTO whatsapp_numbers (phone, created_at)
           SELECT ?, ?
           WHERE ? IS NOT NULL AND NOT EXISTS (SELECT 1 FROM whatsapp_numbers)`,
        )
        .bind(installPhone, now, installPhone),
    ]);

    if (!storeResult.meta.changes || !credentialResult.meta.changes) {
      return { ok: false, error: "Instalasi sudah pernah diselesaikan." };
    }
    return { ok: true };
  } catch (error) {
    console.error("install-run", error);
    return {
      ok: false,
      error: "Instalasi gagal disimpan. Coba lagi atau periksa log.",
    };
  }
}
