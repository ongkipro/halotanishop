/**
 * A short edge cache for anonymous storefront HTML (ADR-029).
 *
 * Every public page is server-rendered, so each request paid the store lookup,
 * the page's D1 reads and the render: 0.5 to 2 seconds before the first byte
 * on a mobile network, the largest single cost in Lighthouse's LCP. The HTML of
 * the home page, the product list and the landing pages is the same for every
 * visitor, so one render serves the next two minutes of them.
 *
 * What makes this safe is how narrow it is:
 *
 * - Only `GET` of `/`, `/produk`, `/produk/<slug>` and single-segment slugs
 *   (landing pages and the legal pages). Product and landing pages pick their
 *   checkout form (`middle` vs `full`) and prefill the province name from the
 *   visitor's Cloudflare province code (`resolveProvinceCode`), so their cache
 *   key carries that two-letter code (`__prov`). Visitors in the same province
 *   share one rendered page; visitors in different provinces never see each
 *   other's form. The geo test pages, the thanks and payment pages, the
 *   installer, `/api`, `/admin` and `/embed` stay out.
 * - Never with an admin session cookie or an Authorization header, so a CMS
 *   preview and the admin never read or write the cache, and never for the
 *   internal rewrite of a product page onto a landing page's path (the outer
 *   `/produk/<slug>` request caches the rewritten HTML under the product's own
 *   province-scoped key).
 * - Only a 200 `text/html` answer with no `Set-Cookie` and no `no-store` or
 *   `private`; anything else is rendered every time.
 * - The key drops ad tracking parameters (`gclid`, `fbclid`, `utm_*`...), so ad
 *   traffic shares the page, and keeps every other parameter, so a filtered
 *   list or a variant is its own entry. The click id cookie is still written
 *   by the middleware on a hit, because it never lived in the HTML.
 *
 * The browser sees `Cache-Control: public, max-age=0, must-revalidate`; the
 * edge lifetime is internal. An admin edit shows within `EDGE_CACHE_SECONDS`.
 * Prices are never read from here: checkout validates them again server-side.
 */
import { SESSION_COOKIE_NAME } from "./auth.ts";
import { CLICK_ID_KEYS } from "./click-ids.ts";
import { resolveProvinceCode } from "./geo.ts";

export const EDGE_CACHE_SECONDS = 120;

/** Parameters that identify an ad click, not a different page, plus the internal province key. */
const TRACKING_PARAMS = new Set<string>([
  ...CLICK_ID_KEYS,
  "ttclid",
  "msclkid",
  "gad_source",
  "gad_campaignid",
  "utm_id",
  "__prov",
]);

/** Single-segment paths that are not shared pages. */
const NOT_SHARED = new Set([
  "api", "admin", "assets", "media", "embed", "feed", "landing", "landing-page",
  "hello", "install", "thanks", "payment",
  "full-form", "middle-form", "hybrid-form", "geoipform",
  "form-full", "form-middle", "form-hybrid",
]);

export function edgeCachePath(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/" || path === "/produk") return path;
  if (/^\/produk\/([a-z0-9][a-z0-9-]{0,120})$/i.test(path)) return path;
  const match = /^\/([a-z0-9][a-z0-9-]{0,80})$/i.exec(path);
  return match && !NOT_SHARED.has(match[1].toLowerCase()) ? path : null;
}

/** The cache key for this request, or null when it must not touch the cache. */
export function edgeCacheRequest(request: Request, url: URL): Request | null {
  if (request.method !== "GET") return null;
  if (request.headers.get("authorization")) return null;
  if ((request.headers.get("cookie") ?? "").includes(`${SESSION_COOKIE_NAME}=`)) return null;
  if (url.searchParams.has("preview")) return null;
  // A product page that is a native landing page is rewritten to that page's
  // path, and the middleware runs again for the rewrite. That render is the
  // product page, not the landing page: it must not be stored under the
  // landing page's key, where a direct visit would be served it instead of
  // the redirect to the product URL.
  if (request.headers.has("x-adsbook-product-page")) return null;
  // A cap on what an arbitrary query string can add to the cache.
  if (url.search.length > 200) return null;
  const path = edgeCachePath(url.pathname);
  if (!path) return null;
  const key = new URL(path, url.origin);
  const kept = [...url.searchParams]
    .filter(([name]) => !TRACKING_PARAMS.has(name.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [name, value] of kept) key.searchParams.append(name, value);
  if (path !== "/" && path !== "/produk") {
    const province = resolveProvinceCode(request);
    if (province) key.searchParams.set("__prov", province);
  }
  return new Request(key.toString(), { method: "GET" });
}

/** Whether an answer may be stored for the next visitor. */
export function isEdgeStorable(response: Response): boolean {
  if (response.status !== 200) return false;
  if (!/text\/html/i.test(response.headers.get("content-type") ?? "")) return false;
  if (response.headers.has("set-cookie")) return false;
  return !/no-store|private/i.test(response.headers.get("cache-control") ?? "");
}

type EdgeCacheStore = { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> };

function defaultCache(): EdgeCacheStore | null {
  const store = (globalThis as { caches?: { default?: EdgeCacheStore } }).caches?.default;
  return store ?? null;
}

/** A cached answer with mutable headers, or null. Never throws. */
export async function readEdgeCache(
  key: Request,
  cache: EdgeCacheStore | null = defaultCache(),
): Promise<Response | null> {
  try {
    const hit = await cache?.match(key);
    if (!hit) return null;
    const response = new Response(hit.body, hit);
    response.headers.delete("X-Edge-Cached-At");
    response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    response.headers.set("X-Edge-Cache", "HIT");
    return response;
  } catch (error) {
    console.error("edge-cache-read-failed", error);
    return null;
  }
}

/** Store a copy of a rendered page. Never throws and never delays the answer. */
export function writeEdgeCache(
  key: Request,
  response: Response,
  locals?: { cfContext?: { waitUntil(task: Promise<unknown>): void } },
  cache: EdgeCacheStore | null = defaultCache(),
) {
  if (!cache || !isEdgeStorable(response)) return;
  const copy = new Response(response.clone().body, response);
  copy.headers.set("Cache-Control", `public, max-age=${EDGE_CACHE_SECONDS}`);
  copy.headers.set("X-Edge-Cached-At", String(Date.now()));
  const task = cache.put(key, copy).catch((error) => console.error("edge-cache-write-failed", error));
  if (locals?.cfContext) locals.cfContext.waitUntil(task);
  else void task;
}

/**
 * Uploaded images (`/assets/uploads/…`) come from R2 through the Worker, which
 * Cloudflare's CDN does not cache, so every request paid the middleware and an
 * R2 read: 1.1-1.2 s to the first byte for a home hero, measured on zvara.shop.
 * Upload keys are random and never rewritten, so the bytes behind a URL do not
 * change. The edge copy lives a day, not the browser's year, so an image an
 * operator deletes stops being served within a day.
 */
export const UPLOAD_EDGE_CACHE_SECONDS = 86_400;

/** Marks a body served in place of the object asked for (a missing `-sm`). */
export const STAND_IN_HEADER = "X-Asset-Stand-In";

/**
 * Bumped when entries already in the cache must be abandoned at once. "2": a
 * missing `-sm` had been stored as its stand-in (the full image) and kept being
 * served for a day after the real derivative was written to R2.
 */
const UPLOAD_CACHE_GENERATION = "2";

/** The cache key for an upload; the query string never selects different bytes. */
export function uploadCacheRequest(request: Request, url: URL): Request | null {
  if (request.method !== "GET" || !url.pathname.startsWith("/assets/uploads/")) return null;
  const key = new URL(url.pathname, url.origin);
  key.searchParams.set("__g", UPLOAD_CACHE_GENERATION);
  return new Request(key);
}

export async function readUploadCache(
  key: Request,
  cache: EdgeCacheStore | null = defaultCache(),
): Promise<Response | null> {
  try {
    const hit = await cache?.match(key);
    if (!hit) return null;
    const response = new Response(hit.body, hit);
    response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    response.headers.set("X-Edge-Cache", "HIT");
    return response;
  } catch (error) {
    console.error("upload-cache-read-failed", error);
    return null;
  }
}

/** Store a served upload. Never throws and never delays the answer. */
export function writeUploadCache(
  key: Request,
  response: Response,
  locals?: { cfContext?: { waitUntil(task: Promise<unknown>): void } },
  cache: EdgeCacheStore | null = defaultCache(),
) {
  // A stand-in is never stored: its URL gets different bytes the moment the
  // real derivative exists, which is exactly what an upload entry assumes cannot happen.
  if (!cache || response.status !== 200 || response.headers.has(STAND_IN_HEADER)) return;
  const copy = new Response(response.clone().body, response);
  copy.headers.set("Cache-Control", `public, max-age=${UPLOAD_EDGE_CACHE_SECONDS}`);
  const task = cache.put(key, copy).catch((error) => console.error("upload-cache-write-failed", error));
  if (locals?.cfContext) locals.cfContext.waitUntil(task);
  else void task;
}
