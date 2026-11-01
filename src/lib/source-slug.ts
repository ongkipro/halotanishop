import { nativeLandingPages } from "../data/native-landing-pages.ts";

/**
 * Where an order or a lead came from, as a short slug (PRD A36).
 *
 * The definition is the SQL expression behind the generated column
 * `orders.source_slug` (migration `*_order_source_slug.sql`). This function
 * mirrors it for labels and tests, and `source-slug.test.ts` feeds both the
 * same paths so they cannot drift. Two consequences of matching SQLite:
 *
 * - Lower-casing is ASCII only. SQLite's `lower()` leaves non-ASCII letters
 *   alone, so this does too.
 * - Length is counted in code points, as SQLite's `substr()` counts them.
 *
 * A stored path is client-supplied (`window.location.pathname` for an order,
 * the `Referer` header for a lead). The slug is a label and a group key only:
 * never a URL, and never put in markup unescaped.
 */
export const SOURCE_SLUG_MAX_LENGTH = 80;
export const SOURCE_SLUG_HOME = "beranda";
/** What an order with no recorded source reads as, in every list and report. */
export const SOURCE_SLUG_NONE_LABEL = "(tidak tercatat)";
/** The filter value that selects orders with no recorded source. */
export const SOURCE_SLUG_NONE_FILTER = "__none__";
/** How much of a lead's page path is kept, matching the order routes. */
export const SOURCE_PATH_MAX_LENGTH = 500;

export function sourceSlugFromPath(path: string | null | undefined): string | null {
  if (typeof path !== "string") return null;
  const cutAt = [path.indexOf("?"), path.indexOf("#")].filter((index) => index >= 0);
  const cut = cutAt.length > 0 ? path.slice(0, Math.min(...cutAt)) : path;
  if (cut === "") return null;
  const trimmed = cut.replace(/\/+$/, "");
  if (trimmed === "") return SOURCE_SLUG_HOME;
  const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  const lowered = segment.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return Array.from(lowered).slice(0, SOURCE_SLUG_MAX_LENGTH).join("") || null;
}

/**
 * The page a lead was captured on, from the `Referer` of the form's
 * same-origin `fetch` (the store sends `strict-origin-when-cross-origin`, so a
 * same-origin request carries the full URL). A missing, unparseable or
 * foreign-origin header is null: a lead from another site's page is not a
 * source this store owns.
 */
export function sourcePathFromReferer(
  referer: string | null | undefined,
  requestUrl: URL,
): string | null {
  if (!referer) return null;
  let parsed: URL;
  try {
    parsed = new URL(referer);
  } catch {
    return null;
  }
  if (parsed.origin !== requestUrl.origin) return null;
  return parsed.pathname.slice(0, SOURCE_PATH_MAX_LENGTH) || null;
}

export type SourceLabelKind = "landing" | "native" | "product" | "home" | "slug";
export type SourceLabel = { slug: string; label: string; kind: SourceLabelKind };

type SourceLabelRow = {
  kind: "landing" | "product";
  slug: string;
  title: string | null;
  source: string | null;
};

/**
 * One read that names every slug a report can show: each landing page (CMS or
 * native, by title) and each product page (by the landing that claimed it, or
 * the product). Bounded by the catalogue, not by order history, so it can sit
 * in the same `D1.batch` as the ranking whose slugs it names. Pass `slugs` to
 * narrow it when they are already known.
 */
export function sourceLabelsStatement(database: D1Database, slugs?: readonly string[]) {
  // Each slug binds twice and D1 allows 100 parameters a statement; past 40
  // the whole catalogue is the cheaper read anyway.
  const narrow = slugs && slugs.length > 0 && slugs.length <= 40;
  const marks = narrow ? slugs.map(() => "?").join(", ") : "";
  const statement = database.prepare(`
    SELECT 'landing' AS kind, lp.slug AS slug, lp.title AS title, lp.source AS source
    FROM landing_pages lp
    ${narrow ? `WHERE lp.slug IN (${marks})` : ""}
    UNION ALL
    SELECT 'product' AS kind, p.slug AS slug,
      COALESCE(claim.title, p.title) AS title,
      CASE WHEN claim.id IS NULL THEN 'product' ELSE claim.source END AS source
    FROM products p
    LEFT JOIN landing_pages claim
      ON claim.is_product_page = 1 AND claim.is_active = 1
      AND claim.product_id = CAST(p.id AS TEXT)
    ${narrow ? `WHERE p.slug IN (${marks})` : ""}
  `);
  return narrow ? statement.bind(...slugs, ...slugs) : statement;
}

/**
 * Names each slug. A landing page wins over a product of the same slug (a
 * landing's own URL is `/<slug>`); a product page a landing has claimed reads
 * as that landing, so the operator sees one page, not two names; a native
 * page missing from the table falls back to the compiled register; anything
 * else is the bare slug.
 */
export function sourceLabelsFromRows(
  slugs: readonly (string | null)[],
  rows: readonly SourceLabelRow[],
  register: readonly { slug: string; title: string }[] = nativeLandingPages,
): Map<string, SourceLabel> {
  const landing = new Map<string, SourceLabelRow>();
  const product = new Map<string, SourceLabelRow>();
  for (const row of rows) {
    (row.kind === "landing" ? landing : product).set(row.slug, row);
  }
  const native = new Map(register.map((entry) => [entry.slug, entry.title]));
  const out = new Map<string, SourceLabel>();
  for (const slug of slugs) {
    if (!slug || out.has(slug)) continue;
    const page = landing.get(slug);
    const item = product.get(slug);
    if (page?.title) {
      out.set(slug, { slug, label: page.title, kind: page.source === "native" ? "native" : "landing" });
    } else if (native.has(slug)) {
      out.set(slug, { slug, label: native.get(slug) as string, kind: "native" });
    } else if (item?.title) {
      const kind: SourceLabelKind = item.source === "native" ? "native" : item.source === "cms" ? "landing" : "product";
      out.set(slug, { slug, label: item.title, kind });
    } else if (slug === SOURCE_SLUG_HOME) {
      out.set(slug, { slug, label: "Beranda", kind: "home" });
    } else {
      out.set(slug, { slug, label: slug, kind: "slug" });
    }
  }
  return out;
}

export async function resolveSourceLabels(
  database: D1Database,
  slugs: readonly (string | null)[],
): Promise<Map<string, SourceLabel>> {
  const known = [...new Set(slugs.filter((slug): slug is string => Boolean(slug)))];
  if (known.length === 0) return new Map();
  const result = await sourceLabelsStatement(database, known).all<SourceLabelRow>();
  return sourceLabelsFromRows(known, result.results ?? []);
}

/**
 * The slugs present on the order list (`orders`) or the abandoned-lead list
 * (`leads`), most frequent first, for the source filter. All time, so the
 * menu does not reshuffle as other filters change.
 */
export function sourceFacetStatement(database: D1Database, scope: "orders" | "leads") {
  const status = scope === "leads" ? "shipping_status = 'abandoned'" : "shipping_status <> 'abandoned'";
  // lazy: an all-history GROUP BY, the same order as the list's own COUNT(*)
  // with no period. The list asks for it once per load, not per page; past
  // ~50k orders, narrow it to the selected period.
  return database.prepare(`
    SELECT source_slug AS slug, COUNT(*) AS count
    FROM orders
    WHERE ${status} AND source_slug IS NOT NULL
    GROUP BY source_slug
    ORDER BY count DESC, source_slug
    LIMIT 50
  `);
}

/**
 * The list APIs' `source_slug` parameter as a bound predicate. An unknown
 * slug matches nothing — it never widens to every row — and the sentinel
 * selects orders with no recorded source.
 */
export function sourceSlugPredicate(
  value: string | null | undefined,
  column = "source_slug",
): { sql: string; params: string[] } | null {
  const slug = String(value ?? "").trim();
  if (!slug || slug === "all") return null;
  if (slug === SOURCE_SLUG_NONE_FILTER) return { sql: `${column} IS NULL`, params: [] };
  return { sql: `${column} = ?`, params: [slug.slice(0, SOURCE_SLUG_MAX_LENGTH)] };
}

export type SourceFilterOption = { value: string; label: string; count: number };

export function sourceFilterOptions(
  facets: readonly { slug: string; count: number | string }[],
  labels: Map<string, SourceLabel>,
): SourceFilterOption[] {
  return facets.map((row) => ({
    value: row.slug,
    label: labels.get(row.slug)?.label ?? row.slug,
    count: Number(row.count) || 0,
  }));
}
