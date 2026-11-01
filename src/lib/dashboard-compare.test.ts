import assert from "node:assert/strict";
import test from "node:test";
import { compareCutoff, compareRange, defaultCompareMode } from "./dashboard-compare.ts";

test("a Friday is compared with last Friday; a month with the same dates a month back", () => {
  // 2026-10-30 is a Friday.
  assert.deepEqual(compareRange("2026-10-30", "2026-10-30", "week"), { start: "2026-10-23", end: "2026-10-23" });
  assert.deepEqual(compareRange("2026-10-01", "2026-10-31", "month"), { start: "2026-09-01", end: "2026-09-30" });
  // A whole month against the whole month before, however long each is.
  assert.deepEqual(compareRange("2026-09-01", "2026-09-30", "month"), { start: "2026-08-01", end: "2026-08-31" });
  assert.deepEqual(compareRange("2026-02-01", "2026-02-28", "month"), { start: "2026-01-01", end: "2026-01-31" });
  assert.deepEqual(compareRange("2028-03-01", "2028-03-31", "month"), { start: "2028-02-01", end: "2028-02-29" });
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
  assert.equal(compareCutoff("2026-10-30", "2026-10-30", "2026-10-23", "2026-10-23", now), "2026-10-23T03:00:00.000Z");
  assert.equal(compareCutoff("2026-10-29", "2026-10-29", "2026-10-22", "2026-10-22", now), null, "yesterday is complete");
  // 31 Oct, this month against September: the moment lands on 1 Oct, after
  // September ended, so nothing is cut.
  const oct31 = Date.parse("2026-10-31T03:00:00.000Z");
  assert.equal(compareCutoff("2026-10-01", "2026-10-31", "2026-09-01", "2026-09-30", oct31), null);
});

test("month-to-date is cut at the same moment; finished periods never are", () => {
  const nov15 = Date.parse("2026-11-15T03:00:00.000Z"); // 10:00 WIB
  const range = compareRange("2026-11-01", "2026-11-15", "month");
  assert.deepEqual(range, { start: "2026-10-01", end: "2026-10-15" });
  assert.equal(compareCutoff("2026-11-01", "2026-11-15", range.start, range.end, nov15), "2026-10-15T03:00:00.000Z");
  assert.equal(compareCutoff("2026-11-09", "2026-11-15", "2026-11-02", "2026-11-08", nov15), "2026-11-08T03:00:00.000Z");
  assert.equal(compareCutoff("2026-10-01", "2026-10-31", "2026-09-01", "2026-09-30", nov15), null);
  assert.equal(defaultCompareMode("last_month"), "month");
});
