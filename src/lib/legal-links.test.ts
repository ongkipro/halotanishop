import assert from "node:assert/strict";
import test from "node:test";
import { legalSegments } from "./legal-links.ts";

test("legal paragraphs link internal pages, emails and WhatsApp numbers, and nothing else", () => {
  assert.deepEqual(legalSegments("Lihat [Kebijakan Cookie](/kebijakan-cookie) ya."), [
    { text: "Lihat " },
    { text: "Kebijakan Cookie", href: "/kebijakan-cookie" },
    { text: " ya." },
  ]);
  assert.deepEqual(legalSegments("Email: cs@toko.co.id"), [{ text: "Email: " }, { text: "cs@toko.co.id", href: "mailto:cs@toko.co.id" }]);
  assert.deepEqual(legalSegments("WhatsApp CS: +6281234567890"), [
    { text: "WhatsApp CS: " },
    { text: "+6281234567890", href: "https://wa.me/6281234567890" },
  ]);
  // An external or protocol-relative target is not a link; plain text stays text.
  assert.equal(legalSegments("[x](https://evil.test)").some((s) => s.href), false);
  assert.equal(legalSegments("[x](//evil.test)").some((s) => s.href), false);
  assert.deepEqual(legalSegments("Jl. Melati No. 10 (belakang pasar), RT 01"), [{ text: "Jl. Melati No. 10 (belakang pasar), RT 01" }]);
});
