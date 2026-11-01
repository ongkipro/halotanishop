import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HEALTH_ACTIONS, healthActionFor, REASONS, SIGNAL_TITLES } from "./health-actions.ts";

/**
 * Every reason a classifier in `operational-health.ts` can return, read from
 * its source: `signal("<id>", "<state>", "<reason>"` and the one conditional
 * reason. A new reason added there without an entry here fails below.
 */
function classifierReasons(): Map<string, Set<string>> {
  const source = readFileSync(new URL("./operational-health.ts", import.meta.url), "utf8");
  const pairs = new Map<string, Set<string>>();
  const add = (id: string, reason: string) => {
    if (!pairs.has(id)) pairs.set(id, new Set());
    pairs.get(id)!.add(reason);
  };
  for (const match of source.matchAll(/signal\(\s*"([a-z-]+)",\s*"[a-z]+",\s*("([a-z-]+)"|stalled \? "([a-z-]+)" : "([a-z-]+)")/g)) {
    if (match[3]) add(match[1], match[3]);
    else {
      add(match[1], match[4]);
      add(match[1], match[5]);
    }
  }
  return pairs;
}

test("every reason a classifier returns has an action or an explicit none", () => {
  const pairs = classifierReasons();
  assert.equal(pairs.size, Object.keys(SIGNAL_TITLES).length, "all eight signals were read");
  for (const [id, reasons] of pairs) {
    for (const reason of reasons) {
      assert.ok(
        Object.hasOwn(HEALTH_ACTIONS[id as keyof typeof HEALTH_ACTIONS] ?? {}, reason),
        `${id}:${reason} has no entry in HEALTH_ACTIONS (use null for none)`,
      );
    }
  }
});

test("every reason in the wording table has an action decision, and every action has wording", () => {
  const decided = new Set(Object.values(HEALTH_ACTIONS).flatMap((byReason) => Object.keys(byReason)));
  for (const reason of Object.keys(REASONS)) {
    assert.ok(decided.has(reason), `"${reason}" is worded but no signal decides its action`);
  }
  for (const reason of decided) {
    assert.ok(Object.hasOwn(REASONS, reason), `"${reason}" has an action entry but no wording`);
  }
});

test("every route in the map is a real admin page in the route map", () => {
  const routeMap = readFileSync(new URL("../../docs/route-map.xml", import.meta.url), "utf8");
  const pages = new Set([...routeMap.matchAll(/<route path="([^"]+)"/g)].map((match) => match[1]));
  const hrefs = Object.values(HEALTH_ACTIONS)
    .flatMap((byReason) => Object.values(byReason))
    .flatMap((action) => (action?.kind === "link" ? [action.href] : []));
  assert.ok(hrefs.length > 0);
  for (const href of new Set(hrefs)) assert.ok(pages.has(href), `${href} is not a page`);
});

test("the REQ-220 map: causes inside the admin link, causes outside it name the setting", () => {
  assert.equal(healthActionFor("capi-outbox", "stalled")?.kind, "link");
  assert.deepEqual(healthActionFor("capi-outbox", "terminal-failures"), {
    kind: "link",
    href: "/admin/ads/meta",
    label: "Buka Meta Ads",
  });
  assert.equal((healthActionFor("google-ads-outbox", "stalled") as { href: string }).href, "/admin/ads/google");
  assert.equal((healthActionFor("mengantar", "all-attempts-failed") as { href: string }).href, "/admin/profile");
  assert.equal((healthActionFor("autolaris", "create-failing") as { href: string }).href, "/admin/profile");
  assert.equal((healthActionFor("autolaris", "awaiting-first-payment") as { href: string }).href, "/admin/payments");
  assert.deepEqual(
    { kind: healthActionFor("alerting", "not-configured")?.kind, name: (healthActionFor("alerting", "not-configured") as { name: string }).name },
    { kind: "setting", name: "OPS_ALERT_WEBHOOK_URL" },
  );
  assert.equal((healthActionFor("scheduler", "scheduler-stalled") as { name: string }).name, "triggers.crons");
  assert.equal(healthActionFor("receiver-score", "not-whitelisted")?.kind, "note");
  // No entry is no button, never a guess.
  assert.equal(healthActionFor("capi-outbox", "unreadable"), null);
  assert.equal(healthActionFor("capi-outbox", "no-such-reason"), null);
});
