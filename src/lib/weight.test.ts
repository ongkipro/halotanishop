import assert from "node:assert/strict";
import test from "node:test";
import { formatGrams, formatKg, formatWeight, summarizeOrderWeight } from "./weight.ts";

test("weight reads in grams with kg beside it, Indonesian format", () => {
  assert.equal(formatKg(1250), "1,25 kg");
  assert.equal(formatKg(1000), "1 kg");
  assert.equal(formatWeight(2500), "2.500 g (2,5 kg)");
  assert.equal(formatWeight(250), "250 g (0,25 kg)");
  assert.equal(formatGrams(12500), "12.500 g");
});

test("each line is unit × quantity and the order total is their sum", () => {
  const summary = summarizeOrderWeight([
    { quantity: 2, weight_grams: 1000, weight_recorded: 1 },
    { quantity: 2, weight_grams: 250, weight_recorded: 1 },
  ]);
  assert.deepEqual(summary.items.map((item) => [item.unit, item.line]), [
    [1000, 2000],
    [250, 500],
  ]);
  assert.equal(summary.total, 2500);
  assert.equal(summary.recorded, true);
});

test("a deleted variant reads as unknown, never as zero", () => {
  const summary = summarizeOrderWeight([
    { quantity: 1, weight_grams: 1000, weight_recorded: 0 },
    { quantity: 3, weight_grams: null },
  ]);
  assert.deepEqual(summary.items[1], { unit: null, line: null, recorded: false });
  assert.equal(summary.total, null);
  assert.equal(summary.recorded, false);
});

test("an order without a recorded weight is labelled as the current variant weight", () => {
  const summary = summarizeOrderWeight([{ quantity: 1, weight_grams: 1000, weight_recorded: 0 }]);
  assert.equal(summary.recorded, false);
  assert.equal(summarizeOrderWeight([]).total, null);
});
