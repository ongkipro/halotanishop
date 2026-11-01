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
