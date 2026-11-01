import assert from "node:assert/strict";
import test from "node:test";
import { renderSitemap } from "./sitemap.ts";

test("lastmod appears only when it is a real date, never today's by default", () => {
  const xml = renderSitemap("https://toko.example/", [
    { path: "/" },
    { path: "/promo-a", lastmod: "2026-10-12T08:00:00.000Z" },
    { path: "/produk/a", image: "https://toko.example/a.jpg?x=1&y=2" },
    { path: "/promo-a", lastmod: "2026-01-01" },
  ]);
  assert.equal((xml.match(/<url>/g) || []).length, 3, "a path is listed once");
  assert.match(xml, /<loc>https:\/\/toko\.example\/promo-a<\/loc>\n    <lastmod>2026-10-12<\/lastmod>/);
  assert.equal((xml.match(/<lastmod>/g) || []).length, 1);
  assert.match(xml, /<image:loc>https:\/\/toko\.example\/a\.jpg\?x=1&amp;y=2<\/image:loc>/);
  assert.doesNotMatch(xml, /changefreq|priority|image:title/);
});

test("a noindex store submits no URLs", () => {
  const xml = renderSitemap("https://toko.example", [{ path: "/" }, { path: "/produk/a" }], true);
  assert.doesNotMatch(xml, /<url>/);
  assert.match(xml, /<urlset[^>]*>\n<\/urlset>/);
});
