import { test } from "node:test";
import assert from "node:assert/strict";
import { cardImageSrc } from "./image-derivative.ts";

test("an uploaded image gets a card-sized sibling", () => {
  assert.equal(
    cardImageSrc("/assets/uploads/2026-08-18/e52cf4c3-bd33.webp"),
    "/assets/uploads/2026-08-18/e52cf4c3-bd33-sm.webp",
  );
  assert.equal(
    cardImageSrc("/assets/uploads/2026-08-18/a-b-c.png"),
    "/assets/uploads/2026-08-18/a-b-c-sm.png",
  );
});

test("anything that is not an upload is left exactly as it is", () => {
  // Bundled art, a remote URL, or an empty field must never be rewritten into
  // a path the asset route would refuse.
  assert.equal(cardImageSrc("/images/produk-contoh.webp"), "/images/produk-contoh.webp");
  assert.equal(cardImageSrc("https://cdn.example.com/x.webp"), "https://cdn.example.com/x.webp");
  assert.equal(cardImageSrc(""), "");
});

test("asking twice does not stack suffixes", () => {
  const once = cardImageSrc("/assets/uploads/2026-08-18/a.webp");
  assert.equal(cardImageSrc(once), once);
});

test("a listed static image is swapped for its card twin; an unlisted one is left alone", () => {
  const listed = new Set(["/images/landing/a/hero-product.webp"]);
  assert.equal(
    cardImageSrc("/images/landing/a/hero-product.webp", listed),
    "/images/landing/a/hero-product-sm.webp",
  );
  // No twin listed: a swap would answer 404 through the Worker.
  assert.equal(
    cardImageSrc("/images/landing/b/hero-product.webp", listed),
    "/images/landing/b/hero-product.webp",
  );
  assert.equal(cardImageSrc("/images/landing/b/hero-product.webp", new Set()), "/images/landing/b/hero-product.webp");
});
