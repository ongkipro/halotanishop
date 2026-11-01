import { getEnvValue } from "./env.ts";
import {
  isStorefrontTemplateId,
  type StorefrontTemplateId,
} from "./tenant-contract.ts";

export interface PublicTenantConfig {
  slug: string;
  name: string;
  siteUrl: string;
  description: string;
  logo: string;
  /** Optional header mark beside the wordmark; empty keeps the letter monogram. */
  brandMark: string;
  /** PUBLIC_SITE_NOINDEX: the whole store stays out of search (see siteNoindex). */
  noindex: boolean;
  tagline: string;
  themeColor: string;
  locale: string;
  openGraphLocale: string;
  defaultTitle: string;
  storefrontTemplate: StorefrontTemplateId;
  adminName: string;
}

/** Shape of the identity columns on the single `stores` row (migration 0036). */
export interface StoreIdentityRow {
  name?: string | null;
  slug?: string | null;
  site_url?: string | null;
  description?: string | null;
  logo?: string | null;
  tagline?: string | null;
  theme_color?: string | null;
  locale?: string | null;
  storefront_template?: string | null;
  admin_name?: string | null;
}

/**
 * No logo until the store uploads its own: the storefront then draws a text
 * wordmark, the admin the store's initial, and share images fall back to the
 * store's own icon (/favicon-192.png). The product's old placeholder wordmark
 * (/images/adsbook-mark.webp, "BELUM DIKONFIGURASI") was deleted on
 * 2026-10-31; a store row or env that still names it reads as no logo.
 */
export const DEFAULT_TENANT_LOGO = "";
export const LEGACY_PLACEHOLDER_LOGO = "/images/adsbook-mark.webp";

/**
 * Product defaults for an install that has not been configured yet. A real
 * install supplies these from its `stores` row, or failing that from
 * PUBLIC_SITE_* — these values exist so an unconfigured install describes
 * itself honestly instead of inheriting the identity of whichever store the
 * bundle was built from.
 *
 * `siteUrl` intentionally defaults to a placeholder origin: a wrong-but-obvious
 * canonical URL is easier to notice than one silently pointing at another store.
 */
const defaults = {
  slug: "adsbook",
  name: "AdsBookCMS Store",
  siteUrl: "https://example.com",
  // Deliberately empty, for the reason PUBLIC_SITE_TAGLINE is: a placeholder
  // sentence here does not stay in the config file. It becomes the meta
  // description Google prints under the store's result and, on the home page,
  // the second half of the <title> — so an unconfigured install advertised
  // itself to customers as unconfigured. The resolver below builds a plain,
  // factual sentence from the store's own name instead. Same defect as A-70,
  // one field over.
  description: "",
  // A neutral product mark, never a store's. An install that has not set its
  // own logo must announce that it is unconfigured, not wear someone else's
  // brand — /images/logo.webp belongs to whichever store supplied it.
  logo: DEFAULT_TENANT_LOGO,
  tagline: "",
  themeColor: "#111111",
  locale: "id-ID",
  storefrontTemplate: "compact-market" as StorefrontTemplateId,
  adminName: "AdsBookCMS Admin",
} as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolution order for every field: the database, then the environment, then
 * the product default. A NULL column means "not configured here" rather than
 * "blank", which is what lets an install that predates migration 0036 keep
 * rendering from its environment unchanged.
 */
/**
 * Opt-in for a store whose domain must not compete in search, e.g. an ads and
 * COD funnel on a subdomain beside the brand's main shop selling the same
 * products. Only `true` or `1` turns it on; a typo leaves the store indexed.
 */
export function siteNoindex(env?: Parameters<typeof getEnvValue>[1]): boolean {
  return /^(1|true)$/i.test(getEnvValue("PUBLIC_SITE_NOINDEX", env));
}

/** A root-relative or https image path; anything else is dropped, not rendered. */
function imagePath(value: string): string {
  return /^(\/(?!\/)|https:\/\/)/.test(value) ? value : "";
}

function pick(dbValue: unknown, envKey: string, fallback: string): string {
  return text(dbValue) || getEnvValue(envKey) || fallback;
}

/**
 * A store address must be https — except on this machine. `npm run dev:local`
 * serves http://localhost, and forcing an https address there made every
 * absolute link (feeds, canonical, OG, redirects) point at a host that does
 * not exist. A loopback host can never be a production store, so allowing
 * plain http for it alone weakens nothing.
 */
export function isAcceptedSiteProtocol(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  );
}

function siteOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      isAcceptedSiteProtocol(url) &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    ) {
      return url.origin;
    }
  } catch {
    // Fall through to the placeholder origin.
  }
  return defaults.siteUrl;
}

/**
 * The shapes resolution accepts, exported so the settings editor rejects a
 * value here instead of storing one this module will silently fall back for.
 * An operator who saves `#fff` and is shown `#111111` has been told nothing
 * about why.
 */
export const THEME_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
export const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;
/** Shape only: one @, a dot in the domain, no spaces. Nothing is sent to it. */
export const SUPPORT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function themeColor(value: string): string {
  return THEME_COLOR_PATTERN.test(value) ? value : defaults.themeColor;
}

function locale(value: string): string {
  return LOCALE_PATTERN.test(value) ? value : defaults.locale;
}

/**
 * Runtime template IDs are validated against D1 by the page resolver. Identity
 * resolution only rejects malformed identifiers here so a persisted runtime
 * template can survive middleware without being compiled into the bundle.
 */
function storefrontTemplate(value: string): StorefrontTemplateId {
  if (isStorefrontTemplateId(value)) return value;
  console.error("tenant-malformed-storefront-template", value);
  return defaults.storefrontTemplate;
}

/**
 * Builds the public identity from an optional `stores` row. Pass `null` for a
 * database that has no row yet — a fresh install before the wizard has run.
 */
export function resolveTenantConfig(
  row: StoreIdentityRow | null | undefined,
): Readonly<PublicTenantConfig> {
  const name = pick(row?.name, "PUBLIC_SITE_NAME", defaults.name);
  const tagline = pick(row?.tagline, "PUBLIC_SITE_TAGLINE", defaults.tagline);
  const resolvedLocale = locale(
    pick(row?.locale, "PUBLIC_SITE_LOCALE", defaults.locale),
  );

  return Object.freeze({
    slug: text(row?.slug) || defaults.slug,
    name,
    siteUrl: siteOrigin(pick(row?.site_url, "PUBLIC_SITE_URL", defaults.siteUrl)),
    description:
      pick(row?.description, "PUBLIC_SITE_DESCRIPTION", defaults.description) ||
      `Belanja online di ${name}.`,
    logo: ((value) => (value === LEGACY_PLACEHOLDER_LOGO ? DEFAULT_TENANT_LOGO : value))(
      pick(row?.logo, "PUBLIC_SITE_LOGO", defaults.logo),
    ),
    brandMark: imagePath(getEnvValue("PUBLIC_SITE_BRAND_MARK")),
    noindex: siteNoindex(),
    tagline,
    themeColor: themeColor(
      pick(row?.theme_color, "PUBLIC_SITE_THEME_COLOR", defaults.themeColor),
    ),
    locale: resolvedLocale,
    openGraphLocale: resolvedLocale.replace("-", "_"),
    defaultTitle: tagline ? `${name} - ${tagline}` : name,
    storefrontTemplate: storefrontTemplate(
      pick(
        row?.storefront_template,
        "PUBLIC_STOREFRONT_TEMPLATE",
        defaults.storefrontTemplate,
      ),
    ),
    adminName: pick(row?.admin_name, "PUBLIC_ADMIN_NAME", defaults.adminName),
  });
}

/**
 * The three states a database can be in, which callers must not conflate:
 *
 * - `installed`   — a store row exists.
 * - `uninstalled` — the query worked and there is no row. No migration ever
 *                   inserts one, so this is exactly a database that has been
 *                   migrated but never set up. It is what routes an operator
 *                   to the install wizard.
 * - `unmigrated`  — the `stores` table does not exist. This is not a fault and
 *                   not transient: it means the migration chain was never
 *                   applied. Folding it into `unknown` made a Worker pointed at
 *                   an empty database serve a placeholder storefront with a 200
 *                   and tell nobody.
 * - `unknown`     — the query failed for some other reason. A broken database
 *                   must never be mistaken for an empty one, or a transient
 *                   fault would send a live store to its own installer.
 */
export type StoreIdentityRead =
  | { state: "installed"; row: StoreIdentityRow }
  | { state: "uninstalled" }
  | { state: "unmigrated" }
  | { state: "unknown" };

export async function readStoreIdentity(
  database: D1Database,
): Promise<StoreIdentityRead> {
  try {
    const row = await database
      .prepare(
        "SELECT name, slug, site_url, description, logo, tagline, theme_color, locale, storefront_template, admin_name FROM stores ORDER BY id LIMIT 1",
      )
      .first<StoreIdentityRow>();
    return row ? { state: "installed", row } : { state: "uninstalled" };
  } catch (error) {
    // SQLite reports a missing table as "no such table". D1 wraps it, so match
    // on the message rather than an error code it does not expose.
    if (/no such table/i.test(String((error as Error)?.message ?? error))) {
      console.error("tenant-identity-unmigrated");
      return { state: "unmigrated" };
    }
    console.error("tenant-identity-load", error);
    return { state: "unknown" };
  }
}

/**
 * Reads the single `stores` row. Returns null when the table is empty or
 * unreadable — both mean "fall back to the environment", which is the correct
 * behaviour for identity resolution. Use `readStoreIdentity` where the
 * difference between empty and broken matters.
 */
export async function loadStoreIdentity(
  database: D1Database,
): Promise<StoreIdentityRow | null> {
  const read = await readStoreIdentity(database);
  return read.state === "installed" ? read.row : null;
}

/**
 * Identity resolved from the environment alone, with no database. Used before
 * middleware has run and by build-time tooling such as the catalog feeds.
 */
export const envTenantConfig: Readonly<PublicTenantConfig> =
  resolveTenantConfig(null);

/** `Title - Store`, unless the title already names the store (legal pages do). */
export function withStoreName(title: string, storeName: string): string {
  return storeName && title.toLowerCase().includes(storeName.toLowerCase()) ? title : `${title} - ${storeName}`;
}
