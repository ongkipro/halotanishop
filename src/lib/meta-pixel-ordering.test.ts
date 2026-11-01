import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * fbq's stub queues by arrival order and fbevents replays the queue in that
 * order, so a `track` replayed ahead of the pixel's `init` is discarded —
 * measured against the live library in an isolated frame: `track` then `init`
 * produced zero beacons to `facebook.com/tr`, `init` then `track` produced one.
 * No error, no warning; the browser leg silently stopped existing while its
 * Conversions API twin kept arriving, which is the shape no dashboard shows.
 */

const inlineScript = (path: string, label: string) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const match = source.match(/<script\b[^>]*\bis:inline\b[^>]*>([\s\S]*)<\/script>/);
  assert.ok(match, `${label} must keep its inline script`);
  return match[1];
};

const PIXEL_BASE = inlineScript(
  "../components/storefront/tracking/MetaPixelBase.astro",
  "MetaPixelBase",
);
const LANDING = inlineScript(
  "../components/storefront/tracking/MetaLandingTracker.astro",
  "MetaLandingTracker",
);

/**
 * One tick, no yielding. `astro.config.mjs` sets
 * `build.inlineStylesheets: 'always'`, so no render-blocking stylesheet
 * separates the head bootstrap from the body tracker — this is the ordering a
 * real browser can get, not a pathological worst case.
 */
async function replayPixelThenTracker() {
  const calls: string[] = [];
  const win: Record<string, unknown> = {
    location: { protocol: "https:", href: "https://toko.test/lp/x", pathname: "/lp/x", search: "" },
    addEventListener: () => {},
    setTimeout: () => 0,
    dataLayer: [],
  };
  const doc = {
    cookie: "",
    title: "LP X",
    head: { appendChild: () => {} },
    createElement: () => ({}),
  };
  const noopFetch = () => Promise.resolve({ json: () => Promise.resolve({}) });

  new Function("window", "document", "setTimeout", "fetch", "pixelId", "metaExternalIdCookie", PIXEL_BASE)(
    win, doc, () => 0, noopFetch, "1234567890", "adsbook_meta_external_id",
  );

  const stubbed = win.fbq as (...args: unknown[]) => unknown;
  win.fbq = (...args: unknown[]) => {
    calls.push(`${args[0]}:${args[1]}`);
    return stubbed(...args);
  };

  new Function(
    "window", "document", "setTimeout", "fetch",
    "slug", "contentId", "contentName", "price",
    LANDING,
  )(win, doc, () => 0, noopFetch, "x", "100001", "Produk X", 1000);

  // Wait for the init the external-ID digest gates, rather than a fixed number
  // of ticks: a tick count that is usually enough is a flaky test, not a fast
  // one.
  const deadline = Date.now() + 2000;
  while (!calls.some((call) => call.startsWith("init:")) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  return calls;
}

test("a landing-page ViewContent is never replayed ahead of the pixel init", async () => {
  const calls = await replayPixelThenTracker();
  assert.ok(calls.includes("track:ViewContent"), "ViewContent must still reach the browser leg");
  assert.ok(
    calls.indexOf("init:1234567890") < calls.indexOf("track:ViewContent"),
    `init must precede ViewContent, got ${calls.join(" -> ")}`,
  );
});

test("no tracker reaches fbq('track') around the ordered hook", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const [label, script] of [
    ["MetaLandingTracker", inlineScript("../components/storefront/tracking/MetaLandingTracker.astro", "MetaLandingTracker")],
    ["MetaThanksTracker", inlineScript("../components/storefront/tracking/MetaThanksTracker.astro", "MetaThanksTracker")],
    // AddToCart / InitiateCheckout / Lead fire on interaction, normally long
    // after the init, but a fast tap on a cached page is not "normally".
    ["form-middle", read("../scripts/form-middle.ts")],
    ["form-hybrid", read("../scripts/form-hybrid.ts")],
  ] as const) {
    assert.doesNotMatch(
      script,
      /fbq\)?\(\s*['"]track['"]/,
      `${label} must track through __PS_META_TRACK__, not fbq directly`,
    );
    assert.match(script, /__PS_META_TRACK__/, `${label} must use the ordered hook`);
  }
});

test("the pixel bootstrap mints _fbp in Meta's format before the deferred library, and keeps an existing one", () => {
  const run = (initialCookie: string) => {
    const jar = new Map<string, string>(
      initialCookie ? [[initialCookie.split("=")[0], initialCookie.split("=")[1]]] : [],
    );
    const doc = {
      get cookie() {
        return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      },
      set cookie(line: string) {
        const [pair] = line.split(";");
        const [k, v] = pair.split("=");
        jar.set(k.trim(), v);
      },
      title: "",
      head: { appendChild: () => {} },
      createElement: () => ({}),
    };
    const win: Record<string, unknown> = {
      location: { protocol: "https:", href: "https://toko.test/", pathname: "/", search: "" },
      addEventListener: () => {},
      setTimeout: () => 0,
      dataLayer: [],
    };
    new Function("window", "document", "setTimeout", "fetch", "pixelId", "metaExternalIdCookie", PIXEL_BASE)(
      win, doc, () => 0, () => Promise.resolve({}), "1234567890", "adsbook_meta_external_id",
    );
    return jar.get("_fbp");
  };

  // The server accepts exactly this shape (click-ids.ts FB_BROWSER_ID_PATTERN).
  assert.match(run("") ?? "", /^fb\.1\.\d{13}\.\d{10}$/);
  assert.equal(run("_fbp=fb.1.1700000000000.1234567890"), "fb.1.1700000000000.1234567890");
});
