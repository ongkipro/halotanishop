import { escapeXml } from "./catalog-feed.ts";

export type SitemapEntry = {
  path: string;
  /** Only a real modification date. Absent rather than today's date. */
  lastmod?: string | null;
  image?: string;
};

/**
 * `lastmod` is written only when it is true. Every URL used to carry today's
 * date on every request, and Google stops trusting a site's `lastmod` once it
 * learns the values are always "now". `changefreq` and `priority` are left out
 * for the same reason: Google ignores both.
 *
 * A store that asked to stay out of search (`PUBLIC_SITE_NOINDEX`) serves an
 * empty `urlset`: submitting URLs that answer `noindex` only earns
 * "Submitted URL marked noindex" in Search Console.
 */
export function renderSitemap(origin: string, entries: readonly SitemapEntry[], noindex = false): string {
  const base = origin.replace(/\/$/, "");
  const seen = new Set<string>();
  const urls = noindex
    ? []
    : entries
        .filter((entry) => !seen.has(entry.path) && Boolean(seen.add(entry.path)))
        .map((entry) => {
          const lastmod = entry.lastmod && /^\d{4}-\d{2}-\d{2}/.test(entry.lastmod) ? entry.lastmod.slice(0, 10) : "";
          return [
            "  <url>",
            `    <loc>${escapeXml(base + entry.path)}</loc>`,
            ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
            ...(entry.image
              ? ["    <image:image>", `      <image:loc>${escapeXml(entry.image)}</image:loc>`, "    </image:image>"]
              : []),
            "  </url>",
          ].join("\n");
        });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join("\n")}${urls.length ? "\n" : ""}</urlset>\n`;
}
