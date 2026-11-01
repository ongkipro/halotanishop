import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { adChannelFromClickIds, adChannelSql, type AdChannel } from "./ad-channel.ts";
import { serializeClickIds } from "./click-ids.ts";

/** Stored values as the order routes write them (`serializeClickIds`), plus legacy and broken ones. */
const CASES: Array<[string | null, AdChannel]> = [
  [serializeClickIds({ fbclid: "IwAR1abc", _fbc: "fb.1.1730000000000.IwAR1abc" }), "meta"],
  [serializeClickIds({ _fbp: "fb.1.1730000000000.123456" }), "meta"],
  [serializeClickIds({ utm_source: "instagram", utm_medium: "paid" }), "meta"],
  [serializeClickIds({ gclid: "Cj0KCQ" }), "google"],
  [serializeClickIds({ gbraid: "0AAAAA" }), "google"],
  [serializeClickIds({ wbraid: "0BBBBB", utm_source: "newsletter" }), "google"],
  [serializeClickIds({ utm_source: "google", utm_medium: "cpc" }), "google"],
  [serializeClickIds({ utm_source: "tiktok", utm_medium: "paid" }), "tiktok"],
  [serializeClickIds({ utm_source: "TikTok" }), "tiktok"],
  ['{"ttclid":"E.C.P.legacy"}', "tiktok"],
  [serializeClickIds({ utm_source: "snack", utm_medium: "CPM" }), "other_paid"],
  [serializeClickIds({ utm_source: "whatsapp", utm_medium: "broadcast" }), "organic"],
  [serializeClickIds({ utm_source: "newsletter" }), "organic"],
  [serializeClickIds({ utm_source: "organic" }), "organic"],
  [serializeClickIds({ utm_source: "direct" }), "direct"],
  [serializeClickIds({ utm_campaign: "ramadan" }), "direct"],
  [serializeClickIds({ gclid: "" }), "direct"],
  ["{}", "direct"],
  ["", "direct"],
  ["not json", "direct"],
  ['{"gclid":', "direct"],
  ['["gclid"]', "direct"],
  ['"gclid"', "direct"],
  ['{"gclid":123}', "direct"],
  [null, "direct"],
];

test("each channel from a real stored value, a malformed value and null", () => {
  for (const [raw, expected] of CASES) {
    assert.equal(adChannelFromClickIds(raw), expected, `value ${JSON.stringify(raw)}`);
  }
});

test("the SQL CASE and the function agree on every stored value", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, ad_click_ids TEXT)");
  const insert = sqlite.prepare("INSERT INTO orders (ad_click_ids) VALUES (?)");
  for (const [raw] of CASES) insert.run(raw);
  const rows = sqlite.prepare(`SELECT ad_click_ids, ${adChannelSql()} AS channel FROM orders ORDER BY id`).all() as Array<{
    ad_click_ids: string | null;
    channel: string;
  }>;
  assert.equal(rows.length, CASES.length);
  rows.forEach((row) => {
    assert.equal(row.channel, adChannelFromClickIds(row.ad_click_ids), `value ${JSON.stringify(row.ad_click_ids)}`);
  });
});
