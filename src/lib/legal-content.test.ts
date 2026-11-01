import assert from "node:assert/strict";
import test from "node:test";
import { getTenantLegalPage, legalPages } from "../data/legal.ts";

test("contact content never invents an unconfigured support channel", () => {
  const page = getTenantLegalPage("contact", "Example Store");
  const content = JSON.stringify(page);

  assert.match(content, /belum mempublikasikan kontak customer service/i);
  assert.doesNotMatch(content, /\{\{whatsapp\}\}/);
  assert.doesNotMatch(content, /WhatsApp CS:/);
});

test("contact content renders the configured support channel", () => {
  const page = getTenantLegalPage("contact", "Example Store", {
    supportWhatsapp: "+6281234567890",
  });
  const content = JSON.stringify(page);

  assert.match(content, /WhatsApp CS: \+6281234567890/);
  assert.doesNotMatch(content, /belum mempublikasikan/i);
});

test("default legal content avoids unsupported guarantees", () => {
  const content = JSON.stringify(legalPages);

  assert.doesNotMatch(
    content,
    /PCI-DSS|tidak pernah menjual|90 hari|1-2 hari kerja|2-5 hari kerja|retur dalam waktu 7 hari/i,
  );
});

test("policy pages fill the store's settings and drop what it has not set", () => {
  const full = getTenantLegalPage("privacy", "Toko Uji", {
    supportWhatsapp: "+6281234567890",
    supportEmail: "cs@tokouji.id",
    businessAddress: "Jl. Melati 10, Surabaya",
    siteUrl: "https://tokouji.id",
  });
  const fullText = JSON.stringify(full);
  assert.match(fullText, /Situs resmi kami: tokouji\.id\./);
  const contact = full.sections.at(-1);
  assert.equal(contact?.title, "Hubungi Kami");
  assert.deepEqual(contact?.paragraphs.slice(1), [
    "WhatsApp CS: +6281234567890",
    "Email: cs@tokouji.id",
    "Alamat: Jl. Melati 10, Surabaya",
  ]);

  // Nothing configured: no domain sentence, no half-filled contact, a pointer to /kontak.
  for (const key of ["privacy", "shipping", "tos"] as const) {
    const bare = getTenantLegalPage(key, "Toko Uji", { siteUrl: "https://example.com" });
    const text = JSON.stringify(bare);
    assert.doesNotMatch(text, /\{\{|\}\}/, `${key} leaves no placeholder`);
    assert.doesNotMatch(text, /Situs resmi kami/, `${key} names no placeholder domain`);
    assert.deepEqual(bare.sections.at(-1)?.paragraphs, ["Gunakan kontak yang tercantum di halaman [Kontak](/kontak)."]);
  }

  // Email only: the contact page shows it and nothing it does not have.
  const emailOnly = JSON.stringify(getTenantLegalPage("contact", "Toko Uji", { supportEmail: "cs@tokouji.id" }));
  assert.match(emailOnly, /Email: cs@tokouji\.id/);
  assert.doesNotMatch(emailOnly, /WhatsApp CS:|Alamat|belum mempublikasikan/);
});
