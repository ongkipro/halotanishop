import assert from "node:assert/strict";
import test from "node:test";
import { compareCutoff, compareRange, defaultCompareMode } from "./dashboard-compare.ts";

test("a Friday is compared with last Friday; a month with the same dates a month back", () => {
  // 2026-10-30 is a Friday.
  assert.deepEqual(compareRange("2026-10-30", "2026-10-30", "week"), { start: "2026-10-23", end: "2026-10-23" });
  assert.deepEqual(compareRange("2026-10-01", "2026-10-31", "month"), { start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(compareRange("2026-03-01", "2026-03-31", "month"), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(compareRange("2026-10-08", "2026-10-14", "previous"), { start: "2026-10-01", end: "2026-10-07" });
});

test("the default follows the preset", () => {
  assert.equal(defaultCompareMode("today"), "week");
  assert.equal(defaultCompareMode("yesterday"), "week");
  assert.equal(defaultCompareMode("this_month"), "month");
  assert.equal(defaultCompareMode("7d"), "previous");
});

test("a period running to today is compared up to the same moment of its own day", () => {
  const now = Date.parse("2026-10-30T03:00:00.000Z"); // Friday 10:00 WIB
  assert.equal(compareCutoff("2026-10-30", "2026-10-30", "2026-10-23", now), "2026-10-23T03:00:00.000Z");
  assert.equal(compareCutoff("2026-10-29", "2026-10-29", "2026-10-22", now), null, "yesterday is complete");
});
