import assert from "node:assert/strict";
import test from "node:test";
import {
  contentValidationMessage,
  homeContentSchema,
  loadPublishedHomeContent,
  mergeRuntimeProductContent,
  parseContentKey,
  productContentSchema,
  validateContent,
} from "./storefront-content.ts";

const productContent = {
  contentName: "Product presentation",
  headline: "Healthy crops start with precise care",
  subheadline: "A focused presentation for the selected operational product.",
  seoTitle: "Product solution for Indonesian growers",
  seoDescription:
    "A concise product presentation based on reviewed tenant instructions.",
  image: "/images/product.webp",
  heroImage: "/images/product-hero.webp",
  tag: "Plant care",
  relatedCategories: ["Agriculture"],
  description: "Structured product copy without operational commerce state.",
  benefits: ["Clear usage context"],
  keyPoints: ["Reviewed structured content"],
  idealFor: ["Indonesian growers"],
  offerText: "Available variants are shown below.",
  ctaText: "View details",
  reviews: [],
};

test("homepage content accepts no testimonials", () => {
  assert.deepEqual(homeContentSchema.shape.proofs.parse([]), []);
});

test("an empty home-content row is distinguishable from a D1 read failure", async () => {
  const emptyDatabase = {
    prepare: () => ({ first: async () => null }),
  } as unknown as D1Database;
  const failedDatabase = {
    prepare: () => ({
      first: async () => {
        throw new Error("D1 unavailable");
      },
    }),
  } as unknown as D1Database;

  assert.deepEqual(await loadPublishedHomeContent(emptyDatabase), {
    state: "unpublished",
  });
  assert.deepEqual(await loadPublishedHomeContent(failedDatabase), {
    state: "unavailable",
  });
});

test("content keys accept home and canonical D1 product IDs", () => {
  assert.deepEqual(parseContentKey("home"), { key: "home", type: "home" });
  assert.deepEqual(parseContentKey("product:10001"), {
    key: "product:10001",
    type: "product",
    productId: "10001",
  });
  assert.throws(() => parseContentKey("product:../../stores"), /Content key/);
  assert.throws(() => parseContentKey("product:scalev-id"), /Content key/);
});

test("product content rejects operational fields", () => {
  assert.throws(
    () => validateContent("product:10001", { ...productContent, price: 1 }),
    /Unrecognized key|unrecognized/i,
  );
});

test("content rejects raw HTML before persistence", () => {
  assert.throws(
    () =>
      validateContent("product:10001", {
        ...productContent,
        description: "<script>alert(1)</script>",
      }),
    /Raw HTML/,
  );
});

test("valid product content remains structured", () => {
  assert.deepEqual(
    validateContent("product:10001", productContent),
    productContent,
  );
});

test("runtime presentation cannot replace operational product identity", () => {
  const content = productContentSchema.parse(productContent);
  const products = mergeRuntimeProductContent(
    [
      {
        id: 7,
        title: "Operational D1 title",
        slug: "operational-slug",
        category: "Operational category",
        image_url: null,
        is_active: 0,
      },
    ],
    new Map([["7", content]]),
  );
  assert.equal(products[0]?.productName, "Operational D1 title");
  assert.equal(products[0]?.slug, "operational-slug");
  assert.equal(products[0]?.category, "Operational category");
  assert.equal(products[0]?.headline, productContent.headline);
  assert.equal(products[0]?.productId, "7");
});

test("products without published D1 content are not rendered from source fallback", () => {
  const products = mergeRuntimeProductContent(
    [
      {
        id: 7,
        title: "Operational D1 title",
        slug: "operational-slug",
        category: "Operational category",
        image_url: null,
        is_active: 1,
      },
    ],
    new Map(),
  );
  assert.deepEqual(products, []);
});

test("a home content link cannot carry a script scheme", () => {
  const solution = (href: string) => ({ title: "Promo", excerpt: "Ringkasan", image: "/media/a.webp", href });
  const solutions = homeContentSchema.shape.solutions;
  for (const href of ["/promo", "#katalog", "https://wa.me/6281200000000"]) {
    assert.equal(solutions.safeParse([solution(href)]).success, true, href);
  }
  for (const href of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example"]) {
    assert.equal(solutions.safeParse([solution(href)]).success, false, href);
  }
});

test("audit M6: an empty draft is refused with the field names, not the schema's JSON", () => {
  let caught: unknown;
  try { validateContent("home", {}); } catch (error) { caught = error; }
  const message = contentValidationMessage(caught);
  assert.ok(message?.startsWith("Konten belum lengkap atau tidak valid: "), String(message));
  assert.match(message!, /hero/);
  assert.doesNotMatch(message!, /[[{]/);
  assert.equal(contentValidationMessage(new Error("Content JSON exceeds 64 KiB.")), null);
});
