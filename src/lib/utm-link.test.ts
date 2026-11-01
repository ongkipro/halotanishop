import assert from "node:assert/strict";
import test from "node:test";
import { buildUtmLink, normalizeUtmTag, UTM_MEDIUMS, UTM_SOURCES, UTM_TAG_MAX_LENGTH } from "./utm-link.ts";

test("REQ-262: a campaign is lower-case hyphenated ASCII", () => {
  assert.equal(normalizeUtmTag("Promo Okt — Kopi Gayo!"), "promo-okt-kopi-gayo");
  assert.equal(normalizeUtmTag("  Promo-Okt  "), "promo-okt");
  assert.equal(normalizeUtmTag("Diskon Lebaran 2026 ✨"), "diskon-lebaran-2026");
  assert.equal(normalizeUtmTag("Café Crème"), "cafe-creme");
  assert.equal(normalizeUtmTag("a__b..c"), "a-b-c");
  assert.equal(normalizeUtmTag("🎉🎉"), "");
  const long = normalizeUtmTag(`${"a".repeat(99)} b`);
  assert.ok(long.length <= UTM_TAG_MAX_LENGTH && !long.endsWith("-"), long);
});

test("REQ-262: the link carries the four tags, encoded, and keeps the page's own query", () => {
  const built = buildUtmLink({
    page: "https://toko.test/promo-kopi?ref=wa#pesan",
    source: "facebook",
    medium: "paid_social",
    campaign: "Promo Okt & Kopi",
    content: "Video A/B",
  });
  assert.ok(built.ok);
  const url = new URL(built.url);
  assert.equal(url.pathname, "/promo-kopi");
  assert.equal(url.hash, "#pesan");
  assert.equal(url.searchParams.get("ref"), "wa");
  assert.equal(url.searchParams.get("utm_source"), "facebook");
  assert.equal(url.searchParams.get("utm_medium"), "paid_social");
  assert.equal(url.searchParams.get("utm_campaign"), "promo-okt-kopi");
  assert.equal(url.searchParams.get("utm_content"), "video-a-b");
  assert.doesNotMatch(built.url, /[ &]Kopi|%20/, "nothing left to encode ambiguously");
});

test("an existing utm tag is replaced, never doubled; content is optional", () => {
  const built = buildUtmLink({
    page: "https://toko.test/produk/madu?utm_campaign=lama&UTM_SOURCE=x&utm_content=lama",
    source: "whatsapp",
    medium: "chat",
    campaign: "broadcast",
  });
  assert.ok(built.ok);
  const params = new URL(built.url).searchParams;
  assert.deepEqual(params.getAll("utm_campaign"), ["broadcast"]);
  assert.equal(params.get("UTM_SOURCE"), null);
  assert.equal(params.get("utm_content"), null);
});

test("refusals: no page, a source or medium off the fixed list, an empty campaign", () => {
  const base = { page: "https://toko.test/x", source: "google", medium: "cpc", campaign: "brand" };
  assert.equal(buildUtmLink({ ...base, page: "" }).ok, false);
  assert.equal(buildUtmLink({ ...base, page: "javascript:alert(1)" }).ok, false);
  assert.equal(buildUtmLink({ ...base, source: "Google" }).ok, false);
  assert.equal(buildUtmLink({ ...base, medium: "email" }).ok, false);
  assert.equal(buildUtmLink({ ...base, campaign: " !!! " }).ok, false);
  // Every suggested medium is on the medium list (PRD A45 Q3).
  for (const source of UTM_SOURCES) assert.ok(UTM_MEDIUMS.some((medium) => medium.value === source.medium), source.value);
});
