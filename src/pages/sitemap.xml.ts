import type { APIRoute } from "astro";
import { getStorefrontProducts } from "../lib/catalog";
import { listPublicLandingPages } from "../lib/landing-pages";
import { nonCanonicalNativeSlugs } from "../lib/native-landing-pages";
import { renderSitemap, type SitemapEntry } from "../lib/sitemap";

export const prerender = false;

/**
 * Generated on demand rather than at build time.
 *
 * `@astrojs/sitemap` only emits entries for prerendered pages, and every route
 * here is server-rendered, so it would have produced nothing. Reading the live
 * catalogue also keeps the sitemap correct as products are added or
 * deactivated in admin — a build-time file would go stale the same day.
 */

// `/kebijakan-cookie` and `/disclaimer` render `noindex`; submitting them here
// only earns "Submitted URL marked noindex" in Search Console.
const STATIC_PATHS = [
  "/",
  "/produk",
  "/tentang",
  "/kontak",
  "/pengiriman",
  "/kebijakan-privasi",
  "/syarat-ketentuan",
];

export const GET: APIRoute = async ({ locals }) => {
  const tenantConfig = locals.tenant;
  const origin = tenantConfig.siteUrl.replace(/\/$/, "");
  const respond = (entries: SitemapEntry[]) =>
    new Response(renderSitemap(origin, entries, tenantConfig.noindex), {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  // Nothing to read when nothing will be listed.
  if (tenantConfig.noindex) return respond([]);

  // A catalogue read failure must not take the sitemap down with it; the static
  // routes are still worth serving. Products carry no modification date
  // (`products` has no `updated_at`), so they carry no `lastmod`.
  let productEntries: SitemapEntry[] = [];
  try {
    const products = await getStorefrontProducts(locals);
    productEntries = products.map((product) => ({
      path: `/produk/${product.slug}`,
      ...(product.heroImage ? { image: new URL(product.heroImage, origin).toString() } : {}),
    }));
  } catch (error) {
    console.error("sitemap-products", error);
  }

  let landingEntries: SitemapEntry[] = [];
  try {
    // The read-only public listing: a sitemap hit (every crawler, hourly) must
    // not run the native-page reconcile writes `listLandingPages` performs.
    const pages = await listPublicLandingPages(locals);
    const duplicates = nonCanonicalNativeSlugs();
    landingEntries = pages
      // A page that has taken over its product's page answers `308` on its own
      // slug, and the product URL is already listed above. Advertising the
      // redirecting address here would hand Google exactly the duplicate pair
      // the takeover exists to prevent.
      .filter((p) => !p.isProductPage)
      // A second ad slug canonical to another page (`canonicalSlug`).
      .filter((p) => !duplicates.has(p.slug))
      .map((p) => ({ path: `/${p.slug}`, lastmod: p.updatedAt }));
    // The index of those pages is a real, linked page too — but only worth
    // advertising when it lists something.
    if (landingEntries.length > 0) landingEntries.unshift({ path: "/landing-page" });
  } catch (error) {
    console.error("sitemap-landing-pages", error);
  }

  return respond([...STATIC_PATHS.map((path) => ({ path })), ...productEntries, ...landingEntries]);
};
