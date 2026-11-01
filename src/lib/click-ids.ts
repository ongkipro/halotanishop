/**
 * Google Ads click identifiers.
 *
 * In a COD funnel the real conversion happens days later, when the courier
 * collects cash — long after the browser session is gone. Uploading that sale
 * back to Google as an offline conversion requires the click id captured at
 * landing, so without this the delivered revenue can never be attributed and
 * Smart Bidding only ever learns from unconfirmed form submissions.
 *
 * Captured server-side from the ad landing URL into a first-party cookie, read
 * back at checkout (cookies ride along with the submit request — no form
 * plumbing), and stored on the order for later upload.
 */

export const CLICK_ID_COOKIE = "adsbook_click_ids";

/** Stable first-party visitor key shared by the Pixel and CAPI legs. */
export const META_EXTERNAL_ID_COOKIE = "adsbook_meta_external_id";

/**
 * Cookie name used before the AdsBookCMS rename. Read-only: an install upgraded
 * mid-campaign would otherwise drop up to 90 days of in-flight click ids that
 * can never be re-captured. Never written, so it ages out on its own.
 */
export const LEGACY_CLICK_ID_COOKIE = "zanoby_click_ids";

/** Click identifiers and attribution tags across Google, Meta, and UTMs. */
export const CLICK_ID_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "_fbp",
  "_fbc",
  "fbclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
export type ClickIdKey = (typeof CLICK_ID_KEYS)[number];
export type ClickIds = Partial<Record<ClickIdKey, string>>;

/**
 * The subset that means an ad click actually happened.
 *
 * `CLICK_ID_KEYS` also carries the five UTM tags, and a UTM tag is not a click:
 * anyone can put one on a WhatsApp broadcast, an email, or an organic post.
 * Only these keys represent a paid click that a conversion can be attributed
 * back to.
 */
export const AD_CLICK_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "_fbc",
  "_fbp",
] as const satisfies readonly ClickIdKey[];

/** True when this set carries a real ad click, not merely campaign tags. */
export function hasAdClickId(ids: ClickIds): boolean {
  return AD_CLICK_KEYS.some((key) => Boolean(ids[key]));
}

/**
 * Keys only an ad click puts on a URL. `_fbp`/`_fbc` are also ad keys, but they
 * are browser cookies the embed widget copies onto every iframe URL, so their
 * mere arrival is not a new click and must not erase a stored `gclid`.
 */
const FRESH_CLICK_KEYS = ["gclid", "gbraid", "wbraid", "fbclid"] as const satisfies readonly ClickIdKey[];

/**
 * What the cookie should hold after a landing, given what it already held.
 *
 * The middleware used to write the parsed URL straight over the cookie, and
 * `hasClickId` counts a bare `utm_source` as a reason to write. So a visitor
 * who clicked a Google ad on Monday and opened the merchant's
 * `?utm_source=whatsapp` follow-up on Wednesday had their `gclid` erased —
 * and in a COD funnel the sale is confirmed on Friday, when that `gclid` is
 * the only thing that can attribute it. The click was paid for and the
 * conversion was silently unattributable.
 *
 * - A new ad click replaces the stored set wholesale: last touch wins, and its
 *   campaign tags belong to it.
 * - Campaign tags alone keep the stored click identity and describe the
 *   current visit, so stale tags from an older click do not linger either.
 */
export function mergeClickIds(stored: ClickIds, incoming: ClickIds): ClickIds {
  if (FRESH_CLICK_KEYS.some((key) => Boolean(incoming[key]))) return incoming;
  const preserved: ClickIds = {};
  for (const key of AD_CLICK_KEYS) {
    const value = stored[key];
    if (value) preserved[key] = value;
  }
  return { ...preserved, ...incoming };
}

// Click ids and tracking tokens are URL-safe strings up to 256 chars.
const CLICK_ID_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;

export function parseClickIdsFromUrl(url: URL): ClickIds {
  const found: ClickIds = {};
  for (const key of CLICK_ID_KEYS) {
    const value = url.searchParams.get(key)?.trim();
    if (value && CLICK_ID_PATTERN.test(value)) found[key] = value;
  }
  if (found.fbclid && !found._fbc) {
    found._fbc = `fb.1.${Date.now()}.${found.fbclid}`;
  }
  return found;
}

export function serializeClickIds(ids: ClickIds): string {
  return JSON.stringify(ids);
}

/**
 * Tolerates anything: a missing cookie, truncated JSON, or a hand-edited value
 * yields an empty result rather than throwing inside the order path.
 */
export function parseClickIds(raw: string | null | undefined): ClickIds {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const found: ClickIds = {};
    for (const key of CLICK_ID_KEYS) {
      const value = parsed?.[key];
      if (typeof value === "string" && CLICK_ID_PATTERN.test(value)) {
        found[key] = value;
      }
    }
    return found;
  } catch {
    return {};
  }
}

export function readClickIdCookie(request: Request): ClickIds {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return {};
  const match =
    cookieHeader.match(new RegExp(`(?:^|;\\s*)${CLICK_ID_COOKIE}=([^;]+)`)) ||
    cookieHeader.match(new RegExp(`(?:^|;\\s*)${LEGACY_CLICK_ID_COOKIE}=([^;]+)`));
  if (!match) return {};
  try {
    return parseClickIds(decodeURIComponent(match[1]));
  } catch {
    return {};
  }
}

export function hasClickId(ids: ClickIds): boolean {
  return CLICK_ID_KEYS.some((key) => Boolean(ids[key]));
}

// fb.<subdomainIndex>.<timestamp>.<payload> — the shape Meta accepts. Kept in
// step with the identical pattern in `meta-event-contract.ts`, which guards the
// browser-supplied copy of the same two values.
const FB_BROWSER_ID_PATTERN = /^fb\.\d\.\d{10,20}\..+$/;

/**
 * `_fbp` and `_fbc` are only usable as CAPI match keys in Meta's own
 * `fb.N.timestamp.payload` shape; anything else degrades event match quality
 * rather than improving it. Exported so the order context that carries these
 * to the server-side Purchase validates them with the same rule this module
 * already applies when it reads the cookie.
 */
export function isValidMetaBrowserId(value: unknown): value is string {
  return typeof value === "string" && FB_BROWSER_ID_PATTERN.test(value);
}
const META_EXTERNAL_ID_PATTERN = /^[a-f0-9]{32}$/;

/**
 * The 32-hex `external_id` the storefront mints and stores in its own cookie.
 * Exported alongside `isValidMetaBrowserId` so a caller carrying these values
 * to a server-side Purchase cannot invent a looser rule than the one this
 * module enforces when it reads them back.
 */
export function isValidMetaExternalId(value: unknown): value is string {
  return typeof value === "string" && META_EXTERNAL_ID_PATTERN.test(value);
}

function readCookieValue(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}


/**
 * Meta's browser identifiers, read server-side.
 *
 * `_fbp` is written by the `MetaPixelBase` bootstrap before the deferred
 * `fbevents.js` loads (which keeps it); `_fbc` is written by the middleware the
 * moment an ad click lands with `fbclid`, and again by the pixel once it loads.
 * `externalId` is a random first-party key minted by `MetaPixelBase`. All three
 * are first-party on the storefront origin, so a same-origin request carries
 * them without the browser having to pass them in a body.
 *
 * Reading them here rather than in each tracker is what stops top-of-funnel
 * events from reaching Meta anonymous: `ViewContent` and `PageView` never sent
 * `user_data` at all, which on one live install was 96% of the CAPI volume. It
 * also survives the cases a browser read cannot — the pixel deferred, blocked,
 * or simply not loaded yet when the event fires.
 */
export function readMetaBrowserIds(
  request: Request,
): { externalId?: string; fbp?: string; fbc?: string } {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return {};
  // The click-id cookie is the fallback for `_fbc` alone: the middleware
  // synthesises it from `fbclid` at landing, so it exists on ad traffic even
  // before the pixel runs. `_fbp` has no such origin — only the pixel bootstrap in the browser mints it.
  const clickIds = readClickIdCookie(request);
  const externalId = readCookieValue(cookieHeader, META_EXTERNAL_ID_COOKIE);
  const fbp = readCookieValue(cookieHeader, "_fbp");
  const directFbc = readCookieValue(cookieHeader, "_fbc");
  return {
    externalId:
      externalId && META_EXTERNAL_ID_PATTERN.test(externalId)
        ? externalId
        : undefined,
    fbp: fbp && FB_BROWSER_ID_PATTERN.test(fbp) ? fbp : undefined,
    fbc:
      directFbc && FB_BROWSER_ID_PATTERN.test(directFbc)
        ? directFbc
        : clickIds._fbc,
  };
}
