import assert from "node:assert/strict";
import test from "node:test";
import {
  adminDateSelectionFromQuery,
  adminMonthGrid,
  adminMonthLabel,
  adminMonthOf,
  daysBetweenAdminDates,
  formatAdminDateRangeLabel,
  formatJakartaDate,
  isAdminDateFilter,
  parseAdminDateSelection,
  resolveAdminDateRange,
  isWithinAdminRange,
  resolveAdminDateSelection,
  shiftAdminMonth,
} from "./admin-date-filter.ts";

const jakartaTuesday = new Date("2026-08-10T17:30:00.000Z");

test("date presets use Jakarta calendar boundaries and inclusive day counts", () => {
  assert.equal(formatJakartaDate(jakartaTuesday), "2026-08-11");
  assert.deepEqual(resolveAdminDateRange("today", jakartaTuesday), {
    start: "2026-08-11",
    end: "2026-08-11",
    interval: "hour",
  });
  assert.deepEqual(resolveAdminDateRange("yesterday", jakartaTuesday), {
    start: "2026-08-10",
    end: "2026-08-10",
    interval: "hour",
  });
  assert.deepEqual(resolveAdminDateRange("7d", jakartaTuesday), {
    start: "2026-08-05",
    end: "2026-08-11",
    interval: "day",
  });
  assert.deepEqual(resolveAdminDateRange("30d", jakartaTuesday), {
    start: "2026-07-13",
    end: "2026-08-11",
    interval: "day",
  });
});

test("month presets and all-time range are stable across year boundaries", () => {
  const january = new Date("2026-01-15T03:00:00.000Z");
  assert.deepEqual(resolveAdminDateRange("all", january), {
    start: "",
    end: "",
    interval: "day",
  });
  assert.deepEqual(resolveAdminDateRange("this_month", january), {
    start: "2026-01-01",
    end: "2026-01-15",
    interval: "day",
  });
  assert.deepEqual(resolveAdminDateRange("last_month", january), {
    start: "2025-12-01",
    end: "2025-12-31",
    interval: "day",
  });
});

test("only supported date-filter values pass validation", () => {
  assert.equal(isAdminDateFilter("all"), true);
  assert.equal(isAdminDateFilter("7d"), true);
  assert.equal(isAdminDateFilter("custom"), false);
  assert.equal(isAdminDateFilter("week"), false);
});

test("an unknown period is refused instead of becoming the 7-day default", () => {
  // This was the latent defect: the order and shipping routes passed an
  // unvalidated string, so anything unrecognised silently became 7d and was
  // presented as the period the operator asked for.
  const unknown = resolveAdminDateSelection("week", { now: jakartaTuesday });
  assert.equal(unknown.ok, false);

  const custom = resolveAdminDateSelection("custom", { now: jakartaTuesday });
  assert.equal(custom.ok, false);
});

test("a valid custom range resolves inclusively and keeps its own dates", () => {
  const resolved = resolveAdminDateSelection("custom", {
    customRange: { start: "2026-08-01", end: "2026-08-11" },
    now: jakartaTuesday,
  });
  assert.equal(resolved.ok, true);
  assert.deepEqual(
    resolved.ok && { start: resolved.start, end: resolved.end, interval: resolved.interval },
    { start: "2026-08-01", end: "2026-08-11", interval: "day" },
  );
});

test("a single-day custom range is read hour by hour, like the today preset", () => {
  const resolved = resolveAdminDateSelection("custom", {
    customRange: { start: "2026-08-11", end: "2026-08-11" },
    now: jakartaTuesday,
  });
  assert.equal(resolved.ok && resolved.interval, "hour");
});

test("an invalid custom range is refused with a stated reason, never coerced", () => {
  const cases: Array<[string, Partial<{ start: string; end: string }>]> = [
    ["missing", {}],
    ["half", { start: "2026-08-01" }],
    ["inverted", { start: "2026-08-11", end: "2026-08-01" }],
    ["unparseable", { start: "01-08-2026", end: "2026-08-11" }],
    ["not a calendar date", { start: "2026-02-31", end: "2026-08-11" }],
    ["future end", { start: "2026-08-01", end: "2026-09-01" }],
  ];
  for (const [label, customRange] of cases) {
    const resolved = resolveAdminDateSelection("custom", {
      customRange,
      now: jakartaTuesday,
    });
    assert.equal(resolved.ok, false, `${label} should be refused`);
    assert.ok(!resolved.ok && resolved.reason.length > 0, `${label} needs a reason`);
  }
});

test("the span cap is inclusive and per surface", () => {
  const thirtyDays = { start: "2026-07-13", end: "2026-08-11" };
  assert.equal(daysBetweenAdminDates(thirtyDays.start, thirtyDays.end) + 1, 30);

  assert.equal(
    resolveAdminDateSelection("custom", {
      customRange: thirtyDays,
      maxCustomRangeDays: 30,
      now: jakartaTuesday,
    }).ok,
    true,
  );
  // One day more than the dashboard allows, but well inside the list default.
  const thirtyOne = { start: "2026-07-12", end: "2026-08-11" };
  assert.equal(
    resolveAdminDateSelection("custom", {
      customRange: thirtyOne,
      maxCustomRangeDays: 30,
      now: jakartaTuesday,
    }).ok,
    false,
  );
  assert.equal(
    resolveAdminDateSelection("custom", { customRange: thirtyOne, now: jakartaTuesday }).ok,
    true,
  );
});

test("the query parser reads one parameter contract for every route", () => {
  const params = new URLSearchParams({
    date_filter: "custom",
    date_start: "2026-08-01",
    date_end: "2026-08-11",
  });
  const parsed = parseAdminDateSelection(params, { now: jakartaTuesday });
  assert.equal(parsed.filter, "custom");
  assert.equal(parsed.resolution.ok && parsed.resolution.start, "2026-08-01");

  // No parameters at all means "all time", which every list defaults to.
  const empty = parseAdminDateSelection(new URLSearchParams(), { now: jakartaTuesday });
  assert.equal(empty.filter, "all");
  assert.equal(empty.resolution.ok, true);
});

test("a range label stays readable when both dates are the same day", () => {
  assert.equal(formatAdminDateRangeLabel("2026-08-01", "2026-08-11"), "01/08/2026 – 11/08/2026");
  assert.equal(formatAdminDateRangeLabel("2026-08-11", "2026-08-11"), "11/08/2026");
});

test("a month grid is 7 columns, blank-padded, with no adjacent-month bleed", () => {
  // August 2026: the 1st is a Saturday, so the first week is six blanks then 1.
  const grid = adminMonthGrid("2026-08");
  assert.ok(grid.every((week) => week.length === 7));
  assert.deepEqual(grid[0], [null, null, null, null, null, null, "2026-08-01"]);
  const flat = grid.flat().filter(Boolean);
  assert.equal(flat[0], "2026-08-01");
  assert.equal(flat[flat.length - 1], "2026-08-31");
  assert.equal(flat.length, 31);
});

test("shifting a month view rolls the year over", () => {
  assert.equal(shiftAdminMonth("2026-08", 1), "2026-09");
  assert.equal(shiftAdminMonth("2026-12", 1), "2027-01");
  assert.equal(shiftAdminMonth("2026-01", -1), "2025-12");
  assert.equal(adminMonthOf("2026-08-22"), "2026-08");
  assert.equal(adminMonthLabel("2026-08"), "Agustus 2026");
});

test("range membership is inclusive and order-insensitive", () => {
  assert.equal(isWithinAdminRange("2026-08-15", "2026-08-10", "2026-08-20"), true);
  assert.equal(isWithinAdminRange("2026-08-10", "2026-08-10", "2026-08-20"), true);
  assert.equal(isWithinAdminRange("2026-08-20", "2026-08-10", "2026-08-20"), true);
  assert.equal(isWithinAdminRange("2026-08-21", "2026-08-10", "2026-08-20"), false);
  // A half-open selection (start picked, end not yet) highlights nothing.
  assert.equal(isWithinAdminRange("2026-08-15", "2026-08-10", ""), false);
  // Same value backwards still works while the user is mid-drag.
  assert.equal(isWithinAdminRange("2026-08-15", "2026-08-20", "2026-08-10"), true);
});

test("audit M4: a list opens on the period its URL names, and on all time otherwise", () => {
  const read = (query: string) => adminDateSelectionFromQuery(new URLSearchParams(query));
  assert.deepEqual(read("date_filter=this_month&source_slug=__none__"), { filter: "this_month", start: "", end: "" });
  assert.deepEqual(read("date_filter=custom&date_start=2026-10-01&date_end=2026-10-07"), { filter: "custom", start: "2026-10-01", end: "2026-10-07" });
  assert.deepEqual(read(""), { filter: "all", start: "", end: "" });
  assert.deepEqual(read("date_filter=forever"), { filter: "all", start: "", end: "" }, "an unknown period is ignored, not sent");
  assert.deepEqual(read("date_filter=custom&date_start=2026-10-07&date_end=2026-10-01"), { filter: "all", start: "", end: "" });
});
