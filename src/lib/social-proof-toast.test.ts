import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isToastBlocked, type SocialProofBlockers } from "./social-proof-visibility.ts";
import { recentOrderCount, SOCIAL_PROOF_MIN_ORDERS, socialProofMessage } from "./social-proof.ts";

const TOAST = readFileSync(
  "src/components/storefront/shared/SocialProofToast.astro",
  "utf8",
);
const PRODUCT_PAGE = readFileSync("src/pages/produk/[slug].astro", "utf8");
const LANDING_PAGE = readFileSync("src/pages/[slug].astro", "utf8");

const clear: SocialProofBlockers = {
  heroVisible: false,
  formVisible: false,
  formFocused: false,
  tabHidden: false,
};

// ---------------------------------------------------------------------------
// Behaviour: executed, not pattern-matched.
// ---------------------------------------------------------------------------

test("the toast shows only when nothing is in its way", () => {
  assert.equal(isToastBlocked(clear), false);
});

test("each blocker alone is enough to suppress the toast", () => {
  // Any one of these firing on its own must hide it. An `&&` slipped in where
  // an `||` belongs would still pass a "shows when clear" test and still pass
  // an "all four block" test — only the singles catch it.
  for (const key of [
    "heroVisible",
    "formVisible",
    "formFocused",
    "tabHidden",
  ] as const) {
    assert.equal(
      isToastBlocked({ ...clear, [key]: true }),
      true,
      `${key} alone must block the toast`,
    );
  }
});

test("the toast returns once every blocker clears", () => {
  // The real sequence on a product page: hero on screen, scrolled past, form
  // reached, a field focused, then blurred and scrolled back up.
  let state: SocialProofBlockers = { ...clear, heroVisible: true };
  assert.equal(isToastBlocked(state), true, "blocked over the hero");

  state = { ...state, heroVisible: false };
  assert.equal(isToastBlocked(state), false, "free between hero and form");

  state = { ...state, formVisible: true };
  assert.equal(isToastBlocked(state), true, "blocked over the form");

  state = { ...state, formFocused: true };
  assert.equal(isToastBlocked(state), true, "still blocked while typing");

  state = { ...state, formVisible: false, formFocused: false };
  assert.equal(isToastBlocked(state), false, "free again after leaving the form");
});

test("the toast can never intercept a tap, and is never announced", () => {
  const rootTag = TOAST.slice(
    TOAST.indexOf("<div\n  data-social-proof"),
    TOAST.indexOf('<div\n    class="flex items-center'),
  );
  assert.match(rootTag, /pointer-events-none/);
  assert.match(rootTag, /aria-hidden="true"/);
  // An aria-hidden focusable descendant is a keyboard trap a screen reader
  // cannot describe, so the toast must contain none.
  const markup = TOAST.slice(
    TOAST.indexOf("<div\n  data-social-proof"),
    TOAST.indexOf("<style>"),
  );
  assert.doesNotMatch(markup, /<(a|button|input|select|textarea)[\s>]/);
});

test("the toast is pinned top-centre", () => {
  const rootTag = TOAST.slice(
    TOAST.indexOf("<div\n  data-social-proof"),
    TOAST.indexOf('<div\n    class="flex items-center'),
  );
  for (const cls of ["fixed", "left-1/2", "top-4", "-translate-x-1/2"]) {
    assert.ok(rootTag.includes(cls), `toast lost its top-centre class ${cls}`);
  }
});

test("the component wires every input the decision logic expects", () => {
  // isToastBlocked is only as good as the signals fed to it.
  assert.match(TOAST, /isToastBlocked\(\{/);
  assert.match(TOAST, /IntersectionObserver/, "hero and form visibility");
  assert.match(TOAST, /visibilitychange/, "tab visibility");
  assert.match(TOAST, /addEventListener\('focus'/, "form focus");
  assert.match(TOAST, /socialProofMessage\(orderCount\)/, "the count decides whether anything renders");
});

test("a missing or invalid blocker selector degrades instead of stranding the toast", () => {
  // A landing page passes no hero selector. `querySelector('')` throws, and an
  // exception during init would leave the toast at opacity-0 forever with no
  // error anyone would notice.
  assert.match(TOAST, /const findBlocker = \(selector: string \| undefined\)/);
  assert.match(TOAST, /try \{\s*return document\.querySelector\(selector\);\s*\} catch/);
  // No hero must mean "never blocked by a hero", not "blocked forever".
  assert.match(TOAST, /else isHeroVisible = false;/);
});

test("hero and form both default to blocking until the observer confirms otherwise", () => {
  // The IntersectionObserver's first callback is always asynchronous, so the
  // unconditional showToast() at the end of init runs on these defaults, not
  // on real data. Only the hero used to default safe (true); form defaulted
  // to false, so a form already in view at load — a short landing page, or a
  // tall viewport where the form sits high on the product page — let the
  // toast flash over it, then hide once the real callback landed, then show
  // again for the same buyer once truly unblocked: a flash-hide-reshow that
  // reads as a duplicate notification. Both must default true (blocked) and
  // both must correct to false only when there is nothing to observe.
  assert.match(TOAST, /let isHeroVisible = true;/);
  assert.match(TOAST, /let isFormVisible = true;/);
  assert.match(TOAST, /if \(hero\) observer\.observe\(hero\);\s*else isHeroVisible = false;/);
  assert.match(
    TOAST,
    /if \(formSection\) observer\.observe\(formSection\);\s*else isFormVisible = false;/,
  );
});

test("init is deferred past load so the toast cannot touch LCP or INP", () => {
  assert.match(TOAST, /setTimeout\(initSocialProof, 2000\)/);
  assert.match(TOAST, /window\.addEventListener\('load'/);
});

test("the toast invents no buyer and names no real one", () => {
  // A-300: it rotated twenty invented buyers under a verified badge. The count
  // comes from the page (server-side); the component itself reads no data and
  // carries no names, cities or verification claim.
  assert.doesNotMatch(TOAST, /OMS_DB|order-status|\/api\//);
  assert.doesNotMatch(TOAST, /Ibu |Bapak |badge-check|data-buyer|Baru saja memesan/);
  assert.match(PRODUCT_PAGE, /orderCount=\{socialProofOrders\}/);
  assert.match(LANDING_PAGE, /orderCount=\{socialProofOrders\}/);
});

test("the notice states a real count only at or above the threshold", () => {
  assert.equal(SOCIAL_PROOF_MIN_ORDERS, 3);
  assert.equal(socialProofMessage(0), null);
  assert.equal(socialProofMessage(SOCIAL_PROOF_MIN_ORDERS - 1), null, "a small number is omitted, never rounded up");
  assert.equal(socialProofMessage(Number.NaN), null);
  assert.equal(socialProofMessage(2.5), null);
  assert.equal(socialProofMessage(3), "3 orang memesan dalam 24 jam terakhir");
  assert.equal(socialProofMessage(1200), "1.200 orang memesan dalam 24 jam terakhir");
  // Store-wide: a store runs many landing pages, so the sentence names no product.
  assert.doesNotMatch(socialProofMessage(9) ?? "", /produk/);
});

test("the count is store-wide, excludes void, cancelled, returned and abandoned orders, and fails to zero", async () => {
  let sql = "";
  let bound: unknown[] = [];
  const database = {
    prepare(text: string) {
      sql = text;
      return {
        bind(...values: unknown[]) {
          bound = values;
          return { first: async () => ({ n: 7 }) };
        },
      };
    },
  } as unknown as D1Database;
  assert.equal(await recentOrderCount(database, new Date("2026-10-29T12:00:00.000Z")), 7);
  assert.match(sql, /FROM orders/);
  assert.doesNotMatch(sql, /product_id/, "one number per store, true on every landing page");
  assert.match(sql, /stock_restored_at IS NULL/);
  // An abandoned lead never became an order; counting it overstated real buyers.
  assert.match(sql, /NOT IN \('cancelled', 'returned', 'abandoned'\)/);
  assert.deepEqual(bound, ["2026-10-28T12:00:00.000Z"], "the window is the 24 hours before now");
  assert.doesNotMatch(sql, /unixepoch\(created_at\)/, "a function on the column defeats the index");

  const failing = { prepare() { throw new Error("D1 down"); } } as unknown as D1Database;
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal(await recentOrderCount(failing), 0, "a failure omits the notice");
  } finally {
    console.error = error;
  }
  assert.equal(await recentOrderCount(undefined), 0);
});

test("the 24-hour count matches the old predicate on real SQLite and uses the created_at index", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      shipping_status TEXT NOT NULL,
      stock_restored_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_orders_created_at ON orders(created_at);
  `);
  const now = new Date("2026-10-29T12:00:00.000Z");
  const insert = sqlite.prepare("INSERT INTO orders (shipping_status, stock_restored_at, created_at) VALUES (?, ?, ?)");
  [
    ["pending", null, "2026-10-28T11:59:59.999Z"], // just outside
    ["pending", null, "2026-10-28T12:00:00.000Z"], // exactly on the edge
    ["pending", null, "2026-10-29T11:59:00.000Z"],
    ["delivered", null, "2026-10-29T03:00:00.000Z"],
    ["abandoned", null, "2026-10-29T04:00:00.000Z"],
    ["cancelled", null, "2026-10-29T05:00:00.000Z"],
    ["pending", "2026-10-29T06:00:00.000Z", "2026-10-29T06:00:00.000Z"],
    ["pending", null, "2026-10-20T00:00:00.000Z"],
  ].forEach((row) => insert.run(...row));
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: string[]) {
          return { first: async () => sqlite.prepare(sql).get(...values) };
        },
      };
    },
  } as unknown as D1Database;

  // The predicate this replaced, evaluated at the same instant.
  const legacy = sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM orders
        WHERE stock_restored_at IS NULL
          AND shipping_status NOT IN ('cancelled', 'returned', 'abandoned')
          AND unixepoch(created_at) >= unixepoch(?, '-24 hours')`,
    )
    .get(now.toISOString()) as { n: number };
  assert.equal(await recentOrderCount(database, now), 3);
  assert.equal(legacy.n, 3, "same answer as the unixepoch predicate");

  const plan = sqlite
    .prepare(
      `EXPLAIN QUERY PLAN SELECT COUNT(*) AS n FROM orders
        WHERE created_at >= ? AND stock_restored_at IS NULL
          AND shipping_status NOT IN ('cancelled', 'returned', 'abandoned')`,
    )
    .all("2026-10-28T12:00:00.000Z") as Array<{ detail: string }>;
  assert.ok(
    plan.some((row) => /USING (COVERING )?INDEX idx_orders_created_at/.test(row.detail)),
    `expected an index search, got ${plan.map((row) => row.detail).join(" | ")}`,
  );
});

test("both public product surfaces mount the toast against anchors they render", () => {
  assert.match(PRODUCT_PAGE, /<SocialProofToast/);
  assert.match(LANDING_PAGE, /<SocialProofToast/);
  // The landing page's checkout anchor differs from the product page's, and a
  // wrong selector fails silently — the toast simply never hides over the form.
  assert.match(LANDING_PAGE, /formSelector="#checkout-form"/);
  // The toast stays off the first screen like the sticky bar. The hero is a
  // viewport-tall marker at the top of the page, not the first section: a
  // merchant section can be a whole page tall, which hid the toast everywhere.
  assert.match(LANDING_PAGE, /heroSelector="\[data-landing-hero\]"/);
  assert.match(LANDING_PAGE, /<div data-landing-hero aria-hidden="true" class="[^"]*\babsolute\b[^"]*\btop-0\b[^"]*\bh-screen\b/);
  assert.doesNotMatch(LANDING_PAGE, /heroMark/);
  assert.ok(
    LANDING_PAGE.includes('id="checkout-form"'),
    "the landing page must still render the #checkout-form anchor the toast watches",
  );
  assert.ok(
    PRODUCT_PAGE.includes('id="form-pemesanan"'),
    "the product page must still render the #form-pemesanan anchor the toast watches",
  );
});

test("the sticky purchase bar ships hidden and hides over the hero as well as the form", () => {
  // The hero fills the first viewport, so a bar that waits for the observer's
  // first callback flashes over the product photo on load.
  assert.match(
    PRODUCT_PAGE,
    /id="sticky-purchase-bar"[^>]*style="transform: translateY\(100%\)/,
  );
  assert.match(PRODUCT_PAGE, /if \(heroVisible \|\| formVisible\)/);
});
