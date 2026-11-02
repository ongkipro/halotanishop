import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { edgeCachePath, edgeCacheRequest, isEdgeStorable, readEdgeCache, writeEdgeCache } from "./edge-cache.ts";

const req = (href: string, init?: RequestInit & { cf?: Record<string, unknown> }) => {
  const { cf, ...rest } = init ?? {};
  const request = new Request(href, rest);
  if (cf) Object.defineProperty(request, "cf", { value: cf });
  return request;
};
const key = (href: string, init?: RequestInit & { cf?: Record<string, unknown> }) =>
  edgeCacheRequest(req(href, init), new URL(href))?.url ?? null;

test("only shared pages are eligible; per-visitor and geo test pages never are", () => {
  for (const path of [
    "/", "/produk", "/produk/", "/produk/aussie", "/produk/4g-lucky-spray-herbal-pria-dewasa/",
    "/aussie-formulabaru", "/kontak", "/Tentang",
  ]) {
    assert.ok(edgeCachePath(path), path);
  }
  for (const path of [
    "/produk/a/b", "/thanks", "/payment", "/hello", "/install", "/admin", "/admin/orders",
    "/api/geo-province", "/full-form", "/middle-form", "/hybrid-form", "/geoipform", "/embed/form",
    "/assets/uploads/x.webp", "/media/x", "/robots.txt", "/sitemap.xml", "/a/b",
  ]) {
    assert.equal(edgeCachePath(path), null, path);
  }
});

test("ad tracking parameters share one entry; real parameters, provinces and bypasses do not", () => {
  const base = "https://store.example/aussie-formulabaru";
  assert.equal(key(base), base);
  assert.equal(key(`${base}?utm_source=fb&utm_campaign=x&fbclid=abc&gclid=g&_fbp=fb.1.2.3`), base);
  assert.equal(key("https://store.example/produk?q=serum&kategori=Sawit"), "https://store.example/produk?kategori=Sawit&q=serum");
  assert.equal(key("https://store.example/produk?kategori=Sawit&q=serum&utm_source=fb"), "https://store.example/produk?kategori=Sawit&q=serum");
  // Product and landing pages partition by the visitor's normalized province code so
  // GeoIpResolvedForm's middle/full choice and prefilled province never leak across provinces.
  const product = "https://store.example/produk/wamena-oil";
  assert.equal(key(product, { cf: { regionCode: "JB" } }), `${product}?__prov=JB`);
  assert.equal(
    key(`${product}?fbclid=click1&utm_source=ig`, { cf: { region: "Jawa Barat" } }),
    `${product}?__prov=JB`,
  );
  assert.equal(key(product, { cf: { regionCode: "PA" } }), `${product}?__prov=PA`);
  assert.equal(key(base, { cf: { regionCode: "JK" } }), `${base}?__prov=JK`);
  // A query string `__prov` from the client cannot forge or collide with the server's province key.
  assert.equal(key(`${product}?__prov=PA`), product);
  assert.equal(key(`${product}?__prov=PA`, { cf: { regionCode: "JB" } }), `${product}?__prov=JB`);
  // Home and catalogue list do not embed a checkout form, so all provinces share one entry.
  assert.equal(key("https://store.example/", { cf: { regionCode: "JB" } }), "https://store.example/");
  assert.equal(key("https://store.example/produk", { cf: { regionCode: "JB" } }), "https://store.example/produk");
  // An admin session, an Authorization header, a preview and a non-GET never use the cache.
  assert.equal(key(base, { headers: { cookie: "adsbook_session=abc" } }), null);
  assert.equal(key(base, { headers: { cookie: "_fbp=x; adsbook_session=abc" } }), null);
  assert.equal(key(base, { headers: { authorization: "Bearer x" } }), null);
  assert.equal(key(`${base}?preview=1`), null);
  // The rewrite of a product page onto a native landing page's path.
  assert.equal(key(base, { headers: { "x-adsbook-product-page": "1" } }), null);
  assert.equal(key(base, { method: "POST", body: "x" }), null);
  assert.equal(key(`${base}?x=${"a".repeat(300)}`), null);
  // A visitor's other cookies do not matter: the page is the same for them.
  assert.equal(key(base, { headers: { cookie: "_fbp=fb.1.2.3; adsbook_click_ids=x" } }), base);
});

test("only a plain 200 html answer without cookies is stored", () => {
  const html = (init: ResponseInit = {}) => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...(init.headers as object) } });
  assert.equal(isEdgeStorable(html()), true);
  assert.equal(isEdgeStorable(html({ headers: { "set-cookie": "a=b" } })), false);
  assert.equal(isEdgeStorable(html({ headers: { "cache-control": "no-store" } })), false);
  assert.equal(isEdgeStorable(html({ headers: { "cache-control": "private, max-age=0" } })), false);
  assert.equal(isEdgeStorable(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })), false);
  assert.equal(isEdgeStorable(new Response("<html></html>", { status: 404, headers: { "content-type": "text/html" } })), false);
  assert.equal(isEdgeStorable(new Response(null, { status: 301, headers: { location: "/x" } })), false);
});

function fakeCache() {
  const map = new Map<string, Response>();
  return {
    map,
    async match(request: Request) { return map.get(request.url)?.clone(); },
    async put(request: Request, response: Response) { map.set(request.url, response); },
  };
}

test("a write is readable as a hit with the internal headers swapped for browser ones", async () => {
  const cache = fakeCache();
  const k = new Request("https://store.example/", { method: "GET" });
  assert.equal(await readEdgeCache(k, cache), null);
  writeEdgeCache(k, new Response("<p>home</p>", { status: 200, headers: { "content-type": "text/html" } }), undefined, cache);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const stored = cache.map.get(k.url)!;
  assert.match(stored.headers.get("cache-control") ?? "", /max-age=120/);
  const hit = await readEdgeCache(k, cache);
  assert.equal(await hit!.text(), "<p>home</p>");
  assert.equal(hit!.headers.get("x-edge-cache"), "HIT");
  assert.equal(hit!.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(hit!.headers.has("x-edge-cached-at"), false);
  // Something that must not be shared is not written.
  const other = new Request("https://store.example/x", { method: "GET" });
  writeEdgeCache(other, new Response("p", { status: 200, headers: { "content-type": "text/html", "set-cookie": "a=b" } }), undefined, cache);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cache.map.has(other.url), false);
  // A broken cache never throws into the page.
  const broken = { match: async () => { throw new Error("down"); }, put: async () => { throw new Error("down"); } };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await readEdgeCache(k, broken), null);
    writeEdgeCache(k, new Response("p", { status: 200, headers: { "content-type": "text/html" } }), undefined, broken);
    await new Promise((resolve) => setTimeout(resolve, 5));
  } finally {
    console.error = originalError;
  }
});

// The middleware itself: a hit must not touch D1, must still write the ad click id cookie, and
// must keep the security headers.
const STUB = "stub:astro-middleware";
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "astro:middleware") return { url: STUB, shortCircuit: true };
    try { return nextResolve(specifier, context); } catch (error) {
      if (!(specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier))) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
  load(url, context, nextLoad) {
    if (url === STUB) return { format: "module", source: "export const defineMiddleware = (handler) => handler;", shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { createMiddleware } = await import("../middleware.ts");
hooks.deregister();
let schemaCalls = 0;
const onRequest = createMiddleware(async () => { schemaCalls += 1; });

async function run(
  href: string,
  next: () => Promise<Response>,
  headers: Record<string, string> = {},
  cf?: Record<string, unknown>,
) {
  const request = req(href, { headers, cf });
  let d1Calls = 0;
  const schemaBefore = schemaCalls;
  const context = {
    request,
    url: new URL(href),
    locals: { runtimeEnv: { OMS_DB: { prepare() { d1Calls += 1; throw new Error("d1 unavailable"); } } } },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, next as never);
  return {
    response: response as Response,
    d1Calls: () => d1Calls,
    schemaCalls: () => schemaCalls - schemaBefore,
  };
}

test("middleware: a hit skips D1 and the render, keeps security headers and writes the click id cookie", async (context) => {
  const cache = fakeCache();
  const original = (globalThis as { caches?: unknown }).caches;
  (globalThis as { caches?: unknown }).caches = { default: cache };
  context.after(() => { (globalThis as { caches?: unknown }).caches = original; });
  const originalError = console.error;
  console.error = () => {};
  context.after(() => { console.error = originalError; });
  let renders = 0;
  const render = async () => { renders += 1; return new Response("<p>live render</p>", { status: 200, headers: { "content-type": "text/html" } }); };

  // First visitor renders and fills the cache; the entry holds no cookie and no security header.
  const first = await run("https://store.example/aussie-formulabaru?utm_source=fb&fbclid=abc123", render);
  assert.equal(await first.response.text(), "<p>live render</p>");
  assert.equal(first.response.headers.get("x-edge-cache"), "MISS");
  assert.equal(first.schemaCalls(), 1);
  assert.match(first.response.headers.get("set-cookie") ?? "", /adsbook_click_ids=/);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const entry = cache.map.get("https://store.example/aussie-formulabaru")!;
  assert.ok(entry, "stored under the key without ad parameters");
  assert.equal(entry.headers.has("set-cookie"), false);
  assert.equal(entry.headers.has("x-frame-options"), false);

  // The next visitor, from another ad, is served from the cache before the schema check or D1.
  const second = await run("https://store.example/aussie-formulabaru?gclid=gg99&utm_campaign=y", render);
  assert.equal(await second.response.text(), "<p>live render</p>");
  assert.equal(renders, 1, "not rendered again");
  assert.equal(second.schemaCalls(), 0, "schema check skipped on a hit");
  assert.equal(second.d1Calls(), 0, "D1 untouched");
  assert.equal(second.response.headers.get("x-edge-cache"), "HIT");
  assert.equal(second.response.headers.get("x-frame-options"), "DENY");
  assert.equal(second.response.headers.get("strict-transport-security"), "max-age=31536000");
  const cookie = second.response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /adsbook_click_ids=[^;]*gclid/);
  assert.equal(cookie.includes("fbclid=abc123"), false, "this visitor's ids, not the first visitor's");

  // Product pages share within a province and isolate between provinces.
  const jbFirst = await run(
    "https://store.example/produk/wamena-oil?fbclid=jb1",
    async () => { renders += 1; return new Response("<p>middle:Jawa Barat</p>", { status: 200, headers: { "content-type": "text/html" } }); },
    {},
    { regionCode: "JB" },
  );
  assert.equal(jbFirst.response.headers.get("x-edge-cache"), "MISS");
  await new Promise((resolve) => setTimeout(resolve, 10));

  const jbSecond = await run(
    "https://store.example/produk/wamena-oil?fbclid=jb2",
    async () => { renders += 1; return new Response("<p>unexpected</p>", { status: 200, headers: { "content-type": "text/html" } }); },
    {},
    { regionCode: "JB" },
  );
  assert.equal(jbSecond.response.headers.get("x-edge-cache"), "HIT");
  assert.equal(await jbSecond.response.text(), "<p>middle:Jawa Barat</p>");
  assert.equal(jbSecond.schemaCalls(), 0, "product hit skips schema check");
  assert.equal(jbSecond.d1Calls(), 0, "product hit skips D1");

  const paFirst = await run(
    "https://store.example/produk/wamena-oil?fbclid=pa1",
    async () => { renders += 1; return new Response("<p>full:Papua</p>", { status: 200, headers: { "content-type": "text/html" } }); },
    {},
    { regionCode: "PA" },
  );
  assert.equal(paFirst.response.headers.get("x-edge-cache"), "MISS");
  assert.equal(await paFirst.response.text(), "<p>full:Papua</p>");

  // An admin session never reads the cache.
  const admin = await run("https://store.example/aussie-formulabaru", async () => new Response("<p>preview</p>", { status: 200, headers: { "content-type": "text/html" } }), { cookie: "adsbook_session=abc" });
  assert.equal(await admin.response.text(), "<p>preview</p>");
  assert.notEqual(admin.response.headers.get("x-edge-cache"), "HIT");
});

test("middleware: an upload is fetched from R2 once, then served without D1 or the route", async (context) => {
  const cache = fakeCache();
  const original = (globalThis as { caches?: unknown }).caches;
  (globalThis as { caches?: unknown }).caches = { default: cache };
  context.after(() => { (globalThis as { caches?: unknown }).caches = original; });
  const originalError = console.error;
  console.error = () => {};
  context.after(() => { console.error = originalError; });
  let reads = 0;
  const image = async () => { reads += 1; return new Response("webp-bytes", { status: 200, headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" } }); };
  const href = "https://store.example/assets/uploads/2026-08-18/ccf44dda-90ac.webp";

  const first = await run(`${href}?v=1`, image);
  assert.equal(first.response.headers.get("x-edge-cache"), "MISS");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const entry = cache.map.get(`${href}?__g=2`)!;
  assert.ok(entry, "stored without the visitor's query string, under the current generation");
  assert.equal(entry.headers.get("cache-control"), "public, max-age=86400", "the edge keeps it a day");

  const second = await run(href, image);
  assert.equal(await second.response.text(), "webp-bytes");
  assert.equal(reads, 1, "R2 read once");
  assert.equal(second.d1Calls(), 0, "D1 untouched");
  assert.equal(second.response.headers.get("x-edge-cache"), "HIT");
  assert.equal(second.response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(second.response.headers.get("x-content-type-options"), "nosniff");

  // A missing upload is not remembered.
  const missing = `${href.replace("ccf44dda-90ac", "deadbeef")}`;
  await run(missing, async () => new Response("Not found", { status: 404 }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cache.map.has(missing), false);
  assert.equal(cache.map.has(`${missing}?__g=2`), false);

  // A stand-in (the full image answering for a missing `-sm`) is not remembered
  // either: once the real derivative is stored, the next request must reach it.
  const card = href.replace(".webp", "-sm.webp");
  await run(card, async () => new Response("full-bytes", { status: 200, headers: { "content-type": "image/webp", "x-asset-stand-in": "1" } }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cache.map.has(`${card}?__g=2`), false);
});
