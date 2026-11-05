import { getRuntimeEnv } from "./env.ts";
import { activeThanksNumbers } from "./whatsapp-numbers.ts";

export async function getStoreSupportWhatsapp(
  locals?: App.Locals,
): Promise<string> {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    // No binding at all: every surface that offers support loses its contact
    // route, and the storefront renders as if support were unconfigured.
    console.error("storefront-support-whatsapp-no-database-binding");
    return "";
  }

  try {
    const store = await (database as D1Database)
      .prepare("SELECT support_whatsapp FROM stores ORDER BY id LIMIT 1")
      .first<{ support_whatsapp: string | null }>();
    if (!store) {
      // No row at all is a different failure from a row with no number saved:
      // the database is migrated but the store was never seeded, so every
      // other stores-backed read on this install is failing too.
      console.error("storefront-support-whatsapp-no-store-row");
      return "";
    }
    // Stored as typed in the admin, often `08…`; every consumer builds a
    // `wa.me/<number>` link, which only resolves in international form.
    return (store.support_whatsapp?.replace(/\D/g, "") || "").replace(/^0/, "62");
  } catch (error) {
    console.error("storefront-support-whatsapp-load", error);
    return "";
  }
}

/**
 * The store's public contact for its legal and contact pages: the first CS
 * WhatsApp in international form with a leading +, and the optional email and
 * business address from Pengaturan → Store (migration 0078). Empty strings for
 * anything unset or unreadable; the pages then drop the sentence that needs it.
 */
export async function getStorePublicContact(locals?: App.Locals): Promise<{
  whatsapp: string;
  email: string;
  address: string;
}> {
  const whatsapp = await getStoreSupportWhatsapp(locals);
  const contact = { whatsapp: whatsapp ? `+${whatsapp}` : "", email: "", address: "" };
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") return contact;
  try {
    const row = await (database as D1Database)
      .prepare("SELECT support_email, business_address FROM stores ORDER BY id LIMIT 1")
      .first<{ support_email: string | null; business_address: string | null }>();
    contact.email = row?.support_email?.trim() || "";
    contact.address = row?.business_address?.trim() || "";
  } catch (error) {
    console.error("storefront-public-contact-load", error instanceof Error ? error.message : "unknown");
  }
  return contact;
}

/**
 * What /thanks needs for its WhatsApp hand-off: the support numbers the
 * rotator picks from (PRD A35, `activeThanksNumbers`) and whether the operator
 * turned the automatic redirect on (migration 0060). Any failure reads as
 * "off" — the page then shows its button, as it always has.
 */
export async function getThanksWhatsappSettings(
  locals?: App.Locals,
): Promise<{ phones: string[]; autoRedirect: boolean }> {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    console.error("storefront-support-whatsapp-no-database-binding");
    return { phones: [], autoRedirect: false };
  }
  const phones = await activeThanksNumbers(database as D1Database);
  if (!phones.length) return { phones, autoRedirect: false };
  try {
    const row = await (database as D1Database)
      .prepare("SELECT thanks_whatsapp_redirect FROM stores ORDER BY id LIMIT 1")
      .first<{ thanks_whatsapp_redirect: number | null }>();
    return { phones, autoRedirect: Number(row?.thanks_whatsapp_redirect) === 1 };
  } catch (error) {
    console.error("storefront-thanks-whatsapp-redirect-load", error);
    return { phones, autoRedirect: false };
  }
}

type PublicPaymentRow = { payment_method: string; name: string; is_active: boolean };

/** "A", "A dan B", "A, B, dan C". */
export function joinIndonesian(items: readonly string[]) {
  if (items.length < 3) return items.join(" dan ");
  return `${items.slice(0, -1).join(", ")}, dan ${items[items.length - 1]}`;
}

/** BCA, BNI, BRI and BSI are spelt in capitals; MANDIRI reads Mandiri. */
const bankName = (name: string) =>
  name.length <= 4 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

/**
 * The payment methods a buyer can actually choose, as one phrase per kind:
 * "COD (bayar di tempat)", "QRIS", "Virtual Account BCA, Mandiri…", "transfer
 * bank Mandiri". Read from `/api/payment-methods`, so a static page never
 * names a method the checkout no longer offers.
 */
export function summarizePaymentMethods(rows: readonly PublicPaymentRow[]) {
  const active = rows.filter((row) => row.is_active);
  const banks = (method: string, prefix: RegExp) =>
    active.filter((row) => row.payment_method === method).map((row) => bankName(row.name.replace(prefix, "").trim()));
  const va = banks("bank_transfer", /^Virtual Account\s*/i);
  const manual = [...new Set(banks("manual_transfer", /^Transfer Bank\s*/i))];
  return [
    ...(active.some((row) => row.payment_method === "cod") ? ["COD (bayar di tempat)"] : []),
    ...(active.some((row) => row.payment_method === "qris") ? ["QRIS"] : []),
    ...(va.length ? [`Virtual Account ${va.join(", ")}`] : []),
    ...(manual.length ? [`transfer bank ${manual.join(", ")}`] : []),
  ];
}

/**
 * What a storefront page may state about the store's logistics and payments,
 * read from the same settings the checkout uses (enabled courier rules, the
 * payment-methods answer, the store's non-COD provinces). Hand-written copy
 * named seven couriers and one bank while the checkout offered five and six
 * (revenleather, 2026-11-02). Nothing here varies per visitor, so a page that
 * prints it stays edge-cacheable.
 */
export async function getStorePublicFacts(locals: App.Locals): Promise<{
  couriers: string[];
  payments: string[];
  codExcludedProvinces: string[];
}> {
  const facts = { couriers: [] as string[], payments: [] as string[], codExcludedProvinces: [] as string[] };
  const database = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;
  const [{ courierDisplayName }, { loadStoreCodDisabledProvinceCodes }, { getProvinceName }, { GET }] = await Promise.all([
    import("./courier-names.ts"),
    import("./form-mode.ts"),
    import("./province.ts"),
    import("../pages/api/payment-methods.ts"),
  ]);
  try {
    const rules = database?.prepare
      ? await database.prepare("SELECT courier_code FROM courier_rules WHERE is_enabled = 1 ORDER BY id").all<{ courier_code: string }>()
      : null;
    facts.couriers = [...new Set((rules?.results ?? []).map((row) => courierDisplayName(row.courier_code)))];
    facts.codExcludedProvinces = (await loadStoreCodDisabledProvinceCodes(database)).map((code) => getProvinceName(code)).filter(Boolean);
    const response = await GET({ locals } as Parameters<typeof GET>[0]);
    const payload = (await response.json()) as { data?: PublicPaymentRow[] };
    facts.payments = summarizePaymentMethods(payload.data ?? []);
  } catch (error) {
    console.error("storefront-public-facts-load", error instanceof Error ? error.message : "unknown");
  }
  return facts;
}
