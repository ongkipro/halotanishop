import assert from "node:assert/strict";
import test from "node:test";
import { getTenantLegalPage } from "../data/legal.ts";

test("shipping copy does not promise a courier list a CS-confirm form never shows (agritani, taniniaga, 2026-11-03)", () => {
  const page = getTenantLegalPage("shipping", "Toko Uji", {});
  const text = page.sections.flatMap((section) => section.paragraphs).join(" ");
  assert.match(text, /Bila formulir pemesanan menampilkan pilihan kurir/);
  assert.match(text, /dikonfirmasi oleh tim kami/);
  assert.doesNotMatch(text, /dihitung otomatis di formulir pemesanan dan ditampilkan/);
});
