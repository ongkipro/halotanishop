import { AD_CHANNELS, adChannelSql, type AdChannel } from "./ad-channel.ts";
import { jsonError, jsonOk } from "./api.ts";
import { getRuntimeEnv } from "./env.ts";
import {
  INSIGHTS_TIMEZONE,
  jakartaDaySql,
  periodClause,
  previousInsightsPeriod,
  resolveInsightsPeriod,
  zeroFillDays,
  type InsightsPeriod,
} from "./insights-period.ts";
import { leadRowSql, orderRowSql, releasedOrderSql } from "./order-metrics.ts";
import { getProvinceName, normalizeProvinceCode } from "./province.ts";
import {
  SOURCE_SLUG_NONE_LABEL,
  sourceLabelsFromRows,
  sourceLabelsStatement,
  sourceSlugPredicate,
  type SourceLabelKind,
} from "./source-slug.ts";

/**
 * The Analitik menu's reads (PRD A37). Each screen is one `D1.batch`: SQL
 * groups, this module shapes, the route only parses and answers. A38's
 * dashboard row calls `landingRanking` and `productRanking` with `limit: 5`,
 * so the two surfaces share one definition of every number.
 *
 * Every value reaching SQL is bound. Nothing returned names a buyer: no name,
 * phone, address or order number is selected, only counts and sums.
 *
 * Counting follows `order-metrics.ts` (REQ-206): an `abandoned` row is a lead;
 * every other row is an order; a released order is an order but not revenue.
 *
 * lazy: bounded live aggregation; A-348 must establish the query-cost ceiling
 * before release. If measured costs exceed it, use an hourly analytics rollup.
 */

const LIVE = `NOT (${releasedOrderSql()})`;
const ORDER_ROW = orderRowSql();
const LEAD_ROW = leadRowSql();
const num = (value: unknown) => Number(value ?? 0) || 0;
const pct = (part: number, base: number) => (base > 0 ? Number(((part / base) * 100).toFixed(2)) : 0);

type BatchResult = { results?: unknown[]; meta?: { rows_read?: number } };

/** Sum of D1's `meta.rows_read` over one batch: what the screen cost. */
export function batchRowsRead(results: readonly BatchResult[]): number {
  return results.reduce((total, result) => total + num(result?.meta?.rows_read), 0);
}

const rowsOf = <T>(result: BatchResult | undefined) => (result?.results ?? []) as T[];

// ── Filters shared by the trend, product, location and time screens ────────

export type InsightsFilter = {
  /** A source slug, or `SOURCE_SLUG_NONE_FILTER` for orders with none. */
  source?: string | null;
  /** One ad channel (REQ-203). */
  channel?: AdChannel | null;
};

export type InsightsFilterResolution =
  | { ok: true; filter: InsightsFilter & { productId: number | null } }
  | { ok: false; reason: string };

/** Reads `source`, `channel` and `product_id`; an unknown channel is refused. */
export function parseInsightsFilter(searchParams: URLSearchParams): InsightsFilterResolution {
  const source = (searchParams.get("source") || "").trim() || null;
  const channelParam = (searchParams.get("channel") || "").trim();
  if (channelParam && !(AD_CHANNELS as readonly string[]).includes(channelParam)) {
    return { ok: false, reason: "Kanal iklan tidak dikenal." };
  }
  const productParam = (searchParams.get("product_id") || "").trim();
  let productId: number | null = null;
  if (productParam) {
    if (!/^[1-9]\d{0,11}$/.test(productParam)) return { ok: false, reason: "Produk tidak valid." };
    productId = Number(productParam);
  }
  return {
    ok: true,
    filter: { source, channel: (channelParam || null) as AdChannel | null, productId },
  };
}

/** The filter as bound predicates over `orders` (alias-aware). */
function filterClause(filter: InsightsFilter, alias = "") {
  const parts: string[] = [];
  const params: string[] = [];
  const slug = sourceSlugPredicate(filter.source, `${alias}source_slug`);
  if (slug) {
    parts.push(slug.sql);
    params.push(...slug.params);
  }
  if (filter.channel) {
    parts.push(`${adChannelSql(`${alias}ad_click_ids`)} = ?`);
    params.push(filter.channel);
  }
  return { sql: parts.map((part) => ` AND ${part}`).join(""), params };
}

// ── A-351 Landing ranking (with the A-355 follow-up funnel) ───────────────

export const LEAD_FOLLOW_UP_STEPS = ["new", "contacted", "qualified", "not_interested"] as const;

type LandingGroupRow = {
  slug: string | null;
  channel: AdChannel;
  leads: number;
  lead_new: number;
  lead_contacted: number;
  lead_qualified: number;
  lead_not_interested: number;
  orders: number;
  converted: number;
  live_orders: number;
  revenue: number;
  delivered: number;
  delivered_revenue: number;
  returned: number;
};

export type LandingRow = {
  /** `null` is the `(tidak tercatat)` row. */
  slug: string | null;
  label: string;
  kind: SourceLabelKind | "none";
  leads: number;
  orders: number;
  live_orders: number;
  revenue: number;
  delivered_revenue: number;
  average_order_value: number;
  /**
   * Orders over orders plus every lead, in percent. A lead marked not
   * interested stays in the denominator: it is a lost sale, and dropping it
   * would let a page that loses most of its leads read as closing them all.
   */
  closing_rate: number;
  /** Delivered over orders, in percent. */
  delivered_share: number;
  /** Returned over delivered plus returned, in percent (the dashboard's RTS base). */
  return_share: number;
  delivered: number;
  returned: number;
  channels: Record<AdChannel, number>;
  follow_up: Record<(typeof LEAD_FOLLOW_UP_STEPS)[number] | "converted", number>;
};

export function landingStatements(database: D1Database, period: InsightsPeriod) {
  const range = periodClause(period);
  const order = `(${ORDER_ROW})`;
  const lead = `(${LEAD_ROW})`;
  return [
    database
      .prepare(
        `SELECT source_slug AS slug, ${adChannelSql()} AS channel,
          SUM(CASE WHEN ${lead} THEN 1 ELSE 0 END) AS leads,
          SUM(CASE WHEN ${lead} AND lead_follow_up_status = 'new' THEN 1 ELSE 0 END) AS lead_new,
          SUM(CASE WHEN ${lead} AND lead_follow_up_status = 'contacted' THEN 1 ELSE 0 END) AS lead_contacted,
          SUM(CASE WHEN ${lead} AND lead_follow_up_status = 'qualified' THEN 1 ELSE 0 END) AS lead_qualified,
          SUM(CASE WHEN ${lead} AND lead_follow_up_status = 'not_interested' THEN 1 ELSE 0 END) AS lead_not_interested,
          SUM(CASE WHEN ${order} THEN 1 ELSE 0 END) AS orders,
          SUM(CASE WHEN ${order} AND lead_follow_up_status = 'converted' THEN 1 ELSE 0 END) AS converted,
          SUM(CASE WHEN ${order} AND ${LIVE} THEN 1 ELSE 0 END) AS live_orders,
          SUM(CASE WHEN ${order} AND ${LIVE} THEN total_amount ELSE 0 END) AS revenue,
          SUM(CASE WHEN ${order} AND shipping_status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN ${order} AND shipping_status = 'delivered' AND ${LIVE} THEN total_amount ELSE 0 END) AS delivered_revenue,
          SUM(CASE WHEN ${order} AND shipping_status = 'returned' THEN 1 ELSE 0 END) AS returned
        FROM orders
        WHERE ${range.sql}
        GROUP BY source_slug, channel`,
      )
      .bind(...range.params),
    // The whole catalogue, not the slugs above: they are not known until the
    // batch returns, and the catalogue is bounded where order history is not.
    sourceLabelsStatement(database),
  ];
}

const emptyChannels = () =>
  Object.fromEntries(AD_CHANNELS.map((channel) => [channel, 0])) as Record<AdChannel, number>;

export function shapeLanding(
  groups: readonly LandingGroupRow[],
  labelRows: Parameters<typeof sourceLabelsFromRows>[1],
  options: { limit?: number } = {},
) {
  const bySlug = new Map<string | null, LandingRow>();
  for (const group of groups) {
    const slug = group.slug ?? null;
    let row = bySlug.get(slug);
    if (!row) {
      row = {
        slug,
        label: SOURCE_SLUG_NONE_LABEL,
        kind: "none",
        leads: 0,
        orders: 0,
        live_orders: 0,
        revenue: 0,
        delivered_revenue: 0,
        average_order_value: 0,
        closing_rate: 0,
        delivered_share: 0,
        return_share: 0,
        delivered: 0,
        returned: 0,
        channels: emptyChannels(),
        follow_up: { new: 0, contacted: 0, qualified: 0, not_interested: 0, converted: 0 },
      };
      bySlug.set(slug, row);
    }
    row.leads += num(group.leads);
    row.orders += num(group.orders);
    row.live_orders += num(group.live_orders);
    row.revenue += num(group.revenue);
    row.delivered_revenue += num(group.delivered_revenue);
    row.delivered += num(group.delivered);
    row.returned += num(group.returned);
    if ((AD_CHANNELS as readonly string[]).includes(group.channel)) {
      row.channels[group.channel] += num(group.orders);
    }
    row.follow_up.new += num(group.lead_new);
    row.follow_up.contacted += num(group.lead_contacted);
    row.follow_up.qualified += num(group.lead_qualified);
    row.follow_up.not_interested += num(group.lead_not_interested);
    row.follow_up.converted += num(group.converted);
  }

  const labels = sourceLabelsFromRows([...bySlug.keys()], labelRows);
  const rows = [...bySlug.values()].map((row) => {
    const label = row.slug ? labels.get(row.slug) : undefined;
    return {
      ...row,
      label: label?.label ?? (row.slug ?? SOURCE_SLUG_NONE_LABEL),
      kind: row.slug ? (label?.kind ?? "slug") : ("none" as const),
      average_order_value: row.live_orders > 0 ? Math.round(row.revenue / row.live_orders) : 0,
      closing_rate: pct(row.orders, row.orders + row.leads),
      delivered_share: pct(row.delivered, row.orders),
      return_share: pct(row.returned, row.delivered + row.returned),
    };
  });

  // Delivered revenue first: the winner is the page whose money arrived
  // (REQ-199). A page of many orders that all came back ranks below a smaller
  // page that was delivered.
  rows.sort(
    (a, b) =>
      b.delivered_revenue - a.delivered_revenue ||
      b.revenue - a.revenue ||
      b.orders - a.orders ||
      b.leads - a.leads ||
      String(a.slug ?? "").localeCompare(String(b.slug ?? "")),
  );

  const totals = rows.reduce(
    (sum, row) => ({
      leads: sum.leads + row.leads,
      orders: sum.orders + row.orders,
      revenue: sum.revenue + row.revenue,
      delivered_revenue: sum.delivered_revenue + row.delivered_revenue,
    }),
    { leads: 0, orders: 0, revenue: 0, delivered_revenue: 0 },
  );

  return {
    rows: options.limit ? rows.slice(0, options.limit) : rows,
    total_sources: rows.length,
    totals,
  };
}

export async function landingRanking(
  database: D1Database,
  period: InsightsPeriod,
  options: { limit?: number } = {},
) {
  const results = (await database.batch(landingStatements(database, period))) as BatchResult[];
  return {
    data: shapeLanding(rowsOf<LandingGroupRow>(results[0]), rowsOf(results[1]) as never, options),
    rowsRead: batchRowsRead(results),
  };
}

// ── A-352 Trend ─────────────────────────────────────────────────────────────

type TrendGroupRow = { date: string; orders: number; leads: number; revenue: number };

/**
 * One source (or none) or one product, optionally one channel. With a
 * product, revenue is that product's line revenue (units × unit price of
 * live orders), and orders and leads are the rows holding it.
 */
function trendSelect(
  database: D1Database,
  period: InsightsPeriod,
  filter: InsightsFilter & { productId?: number | null },
  grouped: boolean,
) {
  const day = grouped ? `${jakartaDaySql("o.")} AS date,` : "";
  const groupBy = grouped ? "GROUP BY date" : "";
  const range = periodClause(period, "o.");
  const where = filterClause(filter, "o.");
  if (filter.productId) {
    return database
      .prepare(
        `SELECT ${day}
          COUNT(DISTINCT CASE WHEN ${orderRowSql("o.")} THEN o.id END) AS orders,
          COUNT(DISTINCT CASE WHEN ${leadRowSql("o.")} THEN o.id END) AS leads,
          COALESCE(SUM(CASE WHEN ${orderRowSql("o.")} AND NOT (${releasedOrderSql("o.")})
            THEN oi.quantity * oi.unit_price ELSE 0 END), 0) AS revenue
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE ${range.sql} AND pv.product_id = ?${where.sql}
        ${groupBy}`,
      )
      .bind(...range.params, filter.productId, ...where.params);
  }
  return database
    .prepare(
      `SELECT ${day}
        COALESCE(SUM(CASE WHEN ${orderRowSql("o.")} THEN 1 ELSE 0 END), 0) AS orders,
        COALESCE(SUM(CASE WHEN ${leadRowSql("o.")} THEN 1 ELSE 0 END), 0) AS leads,
        COALESCE(SUM(CASE WHEN ${orderRowSql("o.")} AND NOT (${releasedOrderSql("o.")}) THEN o.total_amount ELSE 0 END), 0) AS revenue
      FROM orders o
      WHERE ${range.sql}${where.sql}
      ${groupBy}`,
    )
    .bind(...range.params, ...where.params);
}

export function trendStatements(
  database: D1Database,
  period: InsightsPeriod,
  filter: InsightsFilter & { productId?: number | null } = {},
) {
  return [
    trendSelect(database, period, filter, true),
    trendSelect(database, previousInsightsPeriod(period), filter, false),
  ];
}

export function shapeTrend(
  period: InsightsPeriod,
  days: readonly TrendGroupRow[],
  previous: TrendGroupRow | undefined,
) {
  const series = zeroFillDays(period, days, (date, row) => ({
    date,
    orders: num(row?.orders),
    leads: num(row?.leads),
    revenue: num(row?.revenue),
  }));
  const total = series.reduce(
    (sum, day) => ({
      orders: sum.orders + day.orders,
      leads: sum.leads + day.leads,
      revenue: sum.revenue + day.revenue,
    }),
    { orders: 0, leads: 0, revenue: 0 },
  );
  const prior = previousInsightsPeriod(period);
  return {
    series,
    total,
    previous: {
      start: prior.start,
      end: prior.end,
      orders: num(previous?.orders),
      leads: num(previous?.leads),
      revenue: num(previous?.revenue),
    },
  };
}

export async function trendSeries(
  database: D1Database,
  period: InsightsPeriod,
  filter: InsightsFilter & { productId?: number | null } = {},
) {
  const results = (await database.batch(trendStatements(database, period, filter))) as BatchResult[];
  return {
    data: shapeTrend(period, rowsOf<TrendGroupRow>(results[0]), rowsOf<TrendGroupRow>(results[1])[0]),
    rowsRead: batchRowsRead(results),
  };
}

// ── A-353 Product ranking ───────────────────────────────────────────────────

/** What a line whose variant (or product) was deleted reads as. */
export const DELETED_PRODUCT_LABEL = "(produk dihapus)";

type ProductGroupRow = {
  product_id: number | null;
  product_title: string | null;
  variant_id: number;
  variant_title: string | null;
  units: number;
  revenue: number;
  delivered_units: number;
  returned_units: number;
};

export function productStatements(
  database: D1Database,
  period: InsightsPeriod,
  filter: InsightsFilter = {},
) {
  const range = periodClause(period, "o.");
  const where = filterClause(filter, "o.");
  const live = `NOT (${releasedOrderSql("o.")})`;
  return [
    database
      .prepare(
        `SELECT pv.product_id AS product_id, p.title AS product_title,
          oi.variant_id AS variant_id, pv.title AS variant_title,
          SUM(CASE WHEN ${live} THEN oi.quantity ELSE 0 END) AS units,
          SUM(CASE WHEN ${live} THEN oi.quantity * oi.unit_price ELSE 0 END) AS revenue,
          SUM(CASE WHEN o.shipping_status = 'delivered' THEN oi.quantity ELSE 0 END) AS delivered_units,
          SUM(CASE WHEN o.shipping_status = 'returned' THEN oi.quantity ELSE 0 END) AS returned_units
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        LEFT JOIN products p ON p.id = pv.product_id
        WHERE ${orderRowSql("o.")} AND ${range.sql}${where.sql}
        GROUP BY oi.variant_id`,
      )
      .bind(...range.params, ...where.params),
  ];
}

export function shapeProducts(groups: readonly ProductGroupRow[], options: { limit?: number } = {}) {
  type Variant = { variant_id: number | null; label: string; units: number; revenue: number };
  type Product = {
    product_id: number | null;
    label: string;
    units: number;
    revenue: number;
    delivered_units: number;
    returned_units: number;
    return_share: number;
    variants: Variant[];
  };
  const byProduct = new Map<number | null, Product>();
  for (const group of groups) {
    const productId = group.product_id === null || group.product_id === undefined ? null : num(group.product_id);
    let product = byProduct.get(productId);
    if (!product) {
      product = {
        product_id: productId,
        label: (productId !== null && group.product_title) || DELETED_PRODUCT_LABEL,
        units: 0,
        revenue: 0,
        delivered_units: 0,
        returned_units: 0,
        return_share: 0,
        variants: [],
      };
      byProduct.set(productId, product);
    }
    const units = num(group.units);
    const revenue = num(group.revenue);
    product.units += units;
    product.revenue += revenue;
    product.delivered_units += num(group.delivered_units);
    product.returned_units += num(group.returned_units);
    product.variants.push({
      variant_id: productId === null ? null : num(group.variant_id),
      label: group.variant_title || DELETED_PRODUCT_LABEL,
      units,
      revenue,
    });
  }
  const rows = [...byProduct.values()]
    .map((product) => {
      // Every deleted line is one row; its variant ids say nothing.
      const variants =
        product.product_id === null
          ? [{ variant_id: null, label: DELETED_PRODUCT_LABEL, units: product.units, revenue: product.revenue }]
          : product.variants.sort((a, b) => b.units - a.units || b.revenue - a.revenue);
      return {
        ...product,
        variants,
        return_share: pct(product.returned_units, product.delivered_units + product.returned_units),
      };
    })
    .filter((product) => product.units > 0 || product.returned_units > 0 || product.delivered_units > 0)
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue || String(a.label).localeCompare(String(b.label)));
  return {
    rows: options.limit ? rows.slice(0, options.limit) : rows,
    total_products: rows.length,
    totals: rows.reduce(
      (sum, row) => ({ units: sum.units + row.units, revenue: sum.revenue + row.revenue }),
      { units: 0, revenue: 0 },
    ),
  };
}

export async function productRanking(
  database: D1Database,
  period: InsightsPeriod,
  options: { limit?: number; filter?: InsightsFilter } = {},
) {
  const results = (await database.batch(productStatements(database, period, options.filter))) as BatchResult[];
  return {
    data: shapeProducts(rowsOf<ProductGroupRow>(results[0]), options),
    rowsRead: batchRowsRead(results),
  };
}

// ── A-354 Location ranking ──────────────────────────────────────────────────

export const INSIGHTS_TOP_PROVINCES = 20;
export const INSIGHTS_TOP_CITIES = 50;
export const INSIGHTS_TOP_DISTRICTS = 50;
export const OTHER_PLACES_LABEL = "Lainnya";

type LocationGroupRow = {
  province: string | null;
  city: string | null;
  district: string | null;
  orders: number;
  revenue: number;
  delivered: number;
  returned: number;
};

type Place = {
  key: string;
  label: string;
  orders: number;
  revenue: number;
  delivered: number;
  returned: number;
  return_share: number;
};

/**
 * One read for every level: grouped by province, city and district, so a
 * province is the sum of its cities, a city the sum of its districts, and
 * opening either costs nothing more.
 */
export function locationStatements(database: D1Database, period: InsightsPeriod, filter: InsightsFilter = {}) {
  const range = periodClause(period);
  const where = filterClause(filter);
  return [
    database
      .prepare(
        `SELECT province, trim(city) AS city, trim(district) AS district,
          COUNT(*) AS orders,
          SUM(CASE WHEN ${LIVE} THEN total_amount ELSE 0 END) AS revenue,
          SUM(CASE WHEN shipping_status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN shipping_status = 'returned' THEN 1 ELSE 0 END) AS returned
        FROM orders
        WHERE ${ORDER_ROW} AND ${range.sql}${where.sql}
        GROUP BY province, trim(city), trim(district)`,
      )
      .bind(...range.params, ...where.params),
  ];
}

/**
 * A province's report key. Spellings the catalogue (`province.ts`) knows —
 * `Jawa Timur`, `ID-JI`, `Daerah Khusus Ibukota Jakarta` — merge under the
 * code; anything else stays its own row under its trimmed text and is listed
 * in `unmatched_provinces`, so an alias is added to the catalogue, never
 * guessed here.
 */
export function provinceKey(raw: string | null | undefined) {
  const code = normalizeProvinceCode(raw);
  if (code) return { key: code, label: getProvinceName(code), matched: true };
  const text = String(raw ?? "").trim();
  return { key: `raw:${text.toLowerCase()}`, label: text || "(kosong)", matched: false };
}

function topWithOther(places: Place[], top: number) {
  places.sort((a, b) => b.orders - a.orders || b.revenue - a.revenue || a.label.localeCompare(b.label));
  const finish = (place: Place) => ({ ...place, return_share: pct(place.returned, place.delivered + place.returned) });
  if (places.length <= top) return places.map(finish);
  const rest = places.slice(top).reduce(
    (sum, place) => ({
      ...sum,
      orders: sum.orders + place.orders,
      revenue: sum.revenue + place.revenue,
      delivered: sum.delivered + place.delivered,
      returned: sum.returned + place.returned,
    }),
    { key: "other", label: OTHER_PLACES_LABEL, orders: 0, revenue: 0, delivered: 0, returned: 0, return_share: 0 },
  );
  return [...places.slice(0, top).map(finish), finish(rest)];
}

/**
 * Adds a grouped row to the place named by `text` (trimmed, case-insensitive),
 * so `SURABAYA` and `Surabaya` are one city. The label prefers a stored
 * mixed-case spelling, then lexical order, never SQL row order.
 */
function addNamedPlace(places: Map<string, Place>, text: string, group: LocationGroupRow) {
  const key = text.toLowerCase();
  let place = places.get(key);
  if (!place) {
    place = { key, label: text || "(kosong)", orders: 0, revenue: 0, delivered: 0, returned: 0, return_share: 0 };
    places.set(key, place);
  }
  const mixedCase = (value: string) => value !== value.toUpperCase() && value !== value.toLowerCase();
  if ((mixedCase(text) && !mixedCase(place.label)) ||
      (mixedCase(text) === mixedCase(place.label) && text && text < place.label)) {
    place.label = text;
  }
  place.orders += num(group.orders);
  place.revenue += num(group.revenue);
  place.delivered += num(group.delivered);
  place.returned += num(group.returned);
}

export function shapeLocations(
  groups: readonly LocationGroupRow[],
  options: { province?: string | null; city?: string | null } = {},
) {
  const provinces = new Map<string, Place & { spellings: Set<string> }>();
  const unmatched = new Set<string>();
  // The drilldown sends a row's key; an unmatched row's key is `raw:<text>`, which
  // provinceKey would wrap a second time. A name or code still resolves.
  const asked = options.province?.startsWith("raw:")
    ? { key: options.province.toLowerCase(), label: options.province.slice(4).trim() || "(kosong)" }
    : options.province ? provinceKey(options.province) : null;
  const requested = asked?.key ?? null;
  const cities = new Map<string, Place>();
  // A city key is its trimmed lower-cased text, the same key its row carries.
  const requestedCity = requested && options.city != null ? options.city.trim().toLowerCase() : null;
  const districts = new Map<string, Place>();
  // An address counts as a place once its form is complete, the rule checkout
  // applies (`order-schema.ts`: district required). The middle form stores no
  // district and only an IP-guessed province until an operator completes the
  // address, so until then the order is counted here, never under a place.
  const incomplete = { orders: 0, revenue: 0, delivered: 0, returned: 0 };

  for (const group of groups) {
    if (!String(group.district ?? "").trim()) {
      incomplete.orders += num(group.orders);
      incomplete.revenue += num(group.revenue);
      incomplete.delivered += num(group.delivered);
      incomplete.returned += num(group.returned);
      continue;
    }
    const province = provinceKey(group.province);
    if (!province.matched) unmatched.add(String(group.province ?? ""));
    let place = provinces.get(province.key);
    if (!place) {
      place = { key: province.key, label: province.label, orders: 0, revenue: 0, delivered: 0, returned: 0, return_share: 0, spellings: new Set() };
      provinces.set(province.key, place);
    }
    place.spellings.add(String(group.province ?? ""));
    place.orders += num(group.orders);
    place.revenue += num(group.revenue);
    place.delivered += num(group.delivered);
    place.returned += num(group.returned);

    if (requested && province.key === requested) {
      const cityText = String(group.city ?? "").trim();
      addNamedPlace(cities, cityText, group);
      if (requestedCity !== null && cityText.toLowerCase() === requestedCity) {
        addNamedPlace(districts, String(group.district).trim(), group);
      }
    }
  }

  const provinceRows = topWithOther(
    [...provinces.values()].map(({ spellings, ...place }) => ({
      ...place,
      // More than one stored spelling merged under this code: reported so the
      // operator can see the catalogue at work.
      spellings: [...spellings].sort(),
    })) as Place[],
    INSIGHTS_TOP_PROVINCES,
  );
  const total = [...provinces.values()].reduce(
    (sum, place) => ({ orders: sum.orders + place.orders, revenue: sum.revenue + place.revenue }),
    { orders: incomplete.orders, revenue: incomplete.revenue },
  );
  return {
    provinces: provinceRows,
    province: requested
      ? {
          key: requested,
          label: provinces.get(requested)?.label ?? asked!.label,
          cities: topWithOther([...cities.values()], INSIGHTS_TOP_CITIES),
          city: requestedCity !== null
            ? {
                key: requestedCity,
                label: cities.get(requestedCity)?.label ?? (options.city!.trim() || "(kosong)"),
                districts: topWithOther([...districts.values()], INSIGHTS_TOP_DISTRICTS),
              }
            : null,
        }
      : null,
    unmatched_provinces: [...unmatched].sort(),
    incomplete_address: { ...incomplete, return_share: pct(incomplete.returned, incomplete.delivered + incomplete.returned) },
    totals: total,
  };
}

export async function locationRanking(
  database: D1Database,
  period: InsightsPeriod,
  options: { province?: string | null; city?: string | null; filter?: InsightsFilter } = {},
) {
  const results = (await database.batch(locationStatements(database, period, options.filter))) as BatchResult[];
  return {
    data: shapeLocations(rowsOf<LocationGroupRow>(results[0]), options),
    rowsRead: batchRowsRead(results),
  };
}

// ── A-355 Order time heatmap ────────────────────────────────────────────────

type TimeGroupRow = { weekday: number; hour: number; orders: number };

export function timeStatements(database: D1Database, period: InsightsPeriod, filter: InsightsFilter = {}) {
  const range = periodClause(period);
  const where = filterClause(filter);
  return [
    database
      .prepare(
        `SELECT CAST(strftime('%w', created_at, '+7 hours') AS INTEGER) AS weekday,
          CAST(strftime('%H', created_at, '+7 hours') AS INTEGER) AS hour,
          COUNT(*) AS orders
        FROM orders
        WHERE ${ORDER_ROW} AND ${range.sql}${where.sql}
        GROUP BY weekday, hour`,
      )
      .bind(...range.params, ...where.params),
  ];
}

/** `cells[weekday][hour]`, weekday 0 = Sunday, Asia/Jakarta, zero-filled. */
export function shapeTimes(groups: readonly TimeGroupRow[]) {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let max = 0;
  let total = 0;
  for (const group of groups) {
    const weekday = num(group.weekday);
    const hour = num(group.hour);
    if (weekday < 0 || weekday > 6 || hour < 0 || hour > 23) continue;
    cells[weekday][hour] += num(group.orders);
    max = Math.max(max, cells[weekday][hour]);
    total += num(group.orders);
  }
  return { cells, max, total, timezone: "Asia/Jakarta" };
}

export async function orderTimes(database: D1Database, period: InsightsPeriod, filter: InsightsFilter = {}) {
  const results = (await database.batch(timeStatements(database, period, filter))) as BatchResult[];
  return { data: shapeTimes(rowsOf<TimeGroupRow>(results[0])), rowsRead: batchRowsRead(results) };
}

// ── A-429 UTM campaigns ─────────────────────────────────────────────────────

const UTM_PARTS = ["source", "medium", "campaign", "content"] as const;

/**
 * One captured UTM tag as the report groups it (REQ-261): trimmed and
 * lower-cased, empty as NULL. `Promo-Okt ` and `promo-okt` are one campaign.
 * SQLite's `lower` folds ASCII only, which every tag the link builder (REQ-262)
 * writes is.
 */
export function utmTagSql(part: (typeof UTM_PARTS)[number], alias = "") {
  return `NULLIF(lower(trim(CASE WHEN json_valid(${alias}ad_click_ids)
    THEN json_extract(${alias}ad_click_ids, '$.utm_${part}') END)), '')`;
}

type UtmGroupRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  leads: number;
  orders: number;
  live_orders: number;
  revenue: number;
  delivered: number;
  delivered_revenue: number;
  returned: number;
};

export function utmStatements(database: D1Database, period: InsightsPeriod, filter: InsightsFilter = {}) {
  const range = periodClause(period);
  const where = filterClause(filter);
  const order = `(${ORDER_ROW})`;
  return [
    database
      .prepare(
        `SELECT ${UTM_PARTS.map((part) => `${utmTagSql(part)} AS ${part}`).join(", ")},
          SUM(CASE WHEN (${LEAD_ROW}) THEN 1 ELSE 0 END) AS leads,
          SUM(CASE WHEN ${order} THEN 1 ELSE 0 END) AS orders,
          SUM(CASE WHEN ${order} AND ${LIVE} THEN 1 ELSE 0 END) AS live_orders,
          SUM(CASE WHEN ${order} AND ${LIVE} THEN total_amount ELSE 0 END) AS revenue,
          SUM(CASE WHEN ${order} AND shipping_status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN ${order} AND shipping_status = 'delivered' AND ${LIVE} THEN total_amount ELSE 0 END) AS delivered_revenue,
          SUM(CASE WHEN ${order} AND shipping_status = 'returned' THEN 1 ELSE 0 END) AS returned
        FROM orders
        WHERE ${range.sql}${where.sql}
        GROUP BY source, medium, campaign, content`,
      )
      .bind(...range.params, ...where.params),
  ];
}

type UtmMetrics = {
  leads: number;
  orders: number;
  live_orders: number;
  revenue: number;
  delivered: number;
  delivered_revenue: number;
  returned: number;
  /** Orders over orders plus leads, in percent — the landing report's rule. */
  closing_rate: number;
  /** Delivered over orders, in percent. */
  delivered_share: number;
  /** Returned over delivered plus returned, in percent. */
  return_share: number;
};

const emptyUtmMetrics = (): UtmMetrics => ({
  leads: 0, orders: 0, live_orders: 0, revenue: 0, delivered: 0, delivered_revenue: 0, returned: 0,
  closing_rate: 0, delivered_share: 0, return_share: 0,
});

function addUtmMetrics(target: UtmMetrics, group: UtmGroupRow) {
  target.leads += num(group.leads);
  target.orders += num(group.orders);
  target.live_orders += num(group.live_orders);
  target.revenue += num(group.revenue);
  target.delivered += num(group.delivered);
  target.delivered_revenue += num(group.delivered_revenue);
  target.returned += num(group.returned);
}

function finishUtmMetrics<T extends UtmMetrics>(row: T): T {
  row.closing_rate = pct(row.orders, row.orders + row.leads);
  row.delivered_share = pct(row.delivered, row.orders);
  row.return_share = pct(row.returned, row.delivered + row.returned);
  return row;
}

const byUtmValue = (a: UtmMetrics, b: UtmMetrics) =>
  b.delivered_revenue - a.delivered_revenue || b.revenue - a.revenue || b.orders - a.orders || b.leads - a.leads;

/**
 * One row per source / medium / campaign, each with its `utm_content` split;
 * the untagged orders form the last row. Ranked like the landing report,
 * delivered revenue first.
 */
export function shapeUtm(groups: readonly UtmGroupRow[]) {
  type Content = UtmMetrics & { content: string | null };
  type Row = UtmMetrics & {
    key: string;
    source: string | null;
    medium: string | null;
    campaign: string | null;
    untagged: boolean;
    contents: Content[];
  };
  const rows = new Map<string, Row & { byContent: Map<string | null, Content> }>();
  for (const group of groups) {
    const untagged = !group.source && !group.medium && !group.campaign;
    const key = untagged ? "" : JSON.stringify([group.source, group.medium, group.campaign]);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        source: untagged ? null : group.source ?? null,
        medium: untagged ? null : group.medium ?? null,
        campaign: untagged ? null : group.campaign ?? null,
        untagged,
        ...emptyUtmMetrics(),
        contents: [],
        byContent: new Map(),
      };
      rows.set(key, row);
    }
    addUtmMetrics(row, group);
    const contentKey = untagged ? null : group.content ?? null;
    let content = row.byContent.get(contentKey);
    if (!content) {
      content = { content: contentKey, ...emptyUtmMetrics() };
      row.byContent.set(contentKey, content);
    }
    addUtmMetrics(content, group);
  }
  const shaped: Row[] = [...rows.values()]
    .map(({ byContent, ...row }) =>
      finishUtmMetrics({
        ...row,
        contents: row.untagged ? [] : [...byContent.values()].map(finishUtmMetrics).sort(byUtmValue),
      }),
    )
    .filter((row) => row.orders > 0 || row.leads > 0)
    .sort((a, b) => Number(a.untagged) - Number(b.untagged) || byUtmValue(a, b) || a.key.localeCompare(b.key));
  const totals = shaped.reduce(
    (sum, row) => ({ leads: sum.leads + row.leads, orders: sum.orders + row.orders, revenue: sum.revenue + row.revenue }),
    { leads: 0, orders: 0, revenue: 0 },
  );
  const untaggedOrders = shaped.find((row) => row.untagged)?.orders ?? 0;
  return {
    rows: shaped,
    totals,
    /** Orders carrying a source, medium or campaign tag, in percent of all orders. */
    tagged_share: pct(totals.orders - untaggedOrders, totals.orders),
  };
}

export async function utmReport(database: D1Database, period: InsightsPeriod, filter: InsightsFilter = {}) {
  const results = (await database.batch(utmStatements(database, period, filter))) as BatchResult[];
  return { data: shapeUtm(rowsOf<UtmGroupRow>(results[0])), rowsRead: batchRowsRead(results) };
}

// ── Route boundary ──────────────────────────────────────────────────────────

/**
 * Everything an `/api/admin/insights/*` route does besides its one read:
 * the database, the period (400 with the reason), the shared filter (400),
 * and the answer. `Cache-Control: no-store` follows the admin middleware's
 * session-revocation boundary (no KV or edge cache), and `X-D1-Rows-Read` so the A-348 ceiling
 * can be checked against a live screen.
 */
export async function answerInsights(
  context: { locals: App.Locals; url: URL },
  tag: string,
  read: (
    database: D1Database,
    period: InsightsPeriod,
    filter: InsightsFilter & { productId: number | null },
  ) => Promise<{ data: Record<string, unknown>; rowsRead: number }>,
  now = new Date(),
) {
  const database = getRuntimeEnv(context.locals)?.OMS_DB as D1Database | undefined;
  if (!database || typeof database.prepare !== "function") {
    return jsonError("Database analitik belum tersedia.", 503);
  }
  const resolved = resolveInsightsPeriod(context.url.searchParams, now);
  if (!resolved.ok) return jsonError(resolved.reason, 400);
  const parsed = parseInsightsFilter(context.url.searchParams);
  if (!parsed.ok) return jsonError(parsed.reason, 400);
  try {
    const { data, rowsRead } = await read(database, resolved.period, parsed.filter);
    return jsonOk(
      {
        data,
        period: { start_date: resolved.period.start, end_date: resolved.period.end, days: resolved.period.days, timezone: INSIGHTS_TIMEZONE },
      },
      200,
      { "cache-control": "no-store", "x-d1-rows-read": String(rowsRead) },
    );
  } catch (error) {
    console.error(tag, error);
    return jsonError("Gagal mengambil data analitik.", 500);
  }
}
