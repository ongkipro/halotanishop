import {
  isCourierRateEnabled,
  type CourierAvailabilityRule,
} from "./courier-rules.ts";
import { getEnvValue, getRuntimeEnv } from "./env.ts";
import { MengantarClient, type CourierRateResult } from "./mengantar-client.ts";
import { getProviderConfig } from "./provider-config.ts";
import { normalizeProvinceCode } from "./province.ts";
import { buildCityAverageFallbackRate } from "./shipping-fallback.ts";
import {
  chooseWarehouse,
  provinceCodeForCity,
  type WarehouseCandidate,
} from "./warehouse-choice.ts";

export type ShippingQuoteInput = {
  destinationId: string;
  destinationCity?: string;
  paymentMethod: string;
  variantKey?: string;
  originId?: string;
  fallbackWeightKg?: number;
  quantity?: number;
  /**
   * The buyer's province, code or name. When absent it is derived from
   * `destinationCity`, so the rate route and submit, which both carry only the
   * city, choose the same warehouse (PRD A42, REQ-240).
   */
  destinationProvince?: string;
  /**
   * Quote from this warehouse: an admin re-quote of an existing order
   * (REQ-241) or a headless checkout echoing its rate call's `warehouse_id`.
   * Honoured only while it is active and ready (or the primary); otherwise the
   * warehouse is chosen as if it had not been given.
   */
  warehouseId?: number;
  /**
   * Only choose the warehouse: no variant read, no Mengantar call, `rates: []`.
   * Lets headless checkout learn whether a city would leave the primary
   * before it pays for a second rate call (audit finding 23).
   */
  warehouseOnly?: boolean;
  /**
   * Fail instead of re-quoting from the primary when the chosen warehouse's
   * rate call fails or returns no usable rate. Headless checkout sets it: it
   * receives no shipping cost to compare, so a re-quote from another
   * warehouse could charge a price the buyer was never shown.
   */
  noPrimaryFallback?: boolean;
};

export class ShippingQuoteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type QuotedVariant = {
  productTitle: string;
  variantTitle: string;
  unitPrice: number;
  unitWeightKg: number;
};
export type QuotedWarehouse = {
  id: number;
  origin_area_id: string;
  pickup_address_id: string;
};

export type ResolvedShippingRates = {
  originId: string;
  rates: CourierRateResult[];
  warehouse?: QuotedWarehouse;
  variant?: QuotedVariant;
  fallbackUsed?: boolean;
  /** The warehouse whose rate call failed or came back empty, when the quote
   *  was re-made from the primary instead (`warehouse` is then the primary). */
  primaryFallbackFrom?: number;
};

const normalizeCity = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("id-ID")
    .replace(/\b(kota|kabupaten|kab)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The warehouse a quote ships from (PRD A42). A store with one active
 * warehouse makes exactly the one read it made before A42 and gets the same
 * row (REQ-242); only a store with several reads its candidates and lets
 * `chooseWarehouse` pick by the buyer's province.
 */
async function readQuoteWarehouse(
  database: D1Database,
  input: ShippingQuoteInput,
): Promise<QuotedWarehouse | undefined> {
  if (input.warehouseId) {
    // Only a warehouse the chooser could pick: active, and ready or the
    // primary. `warehouse_id` reaches here from public routes, so an inactive
    // or unregistered one is never quoted from; the request then falls
    // through to the normal choice, as for an id that does not exist.
    const own = await database
      .prepare(
        `SELECT id, origin_area_id, pickup_address_id FROM warehouses
        WHERE id = ? AND is_active = 1
          AND (is_primary = 1 OR (TRIM(COALESCE(origin_area_id, '')) <> ''
            AND TRIM(COALESCE(pickup_address_id, '')) <> ''))
        LIMIT 1`,
      )
      .bind(input.warehouseId)
      .first<QuotedWarehouse>();
    if (own) return own;
  }
  const primary = await database
    .prepare(
      `SELECT id, origin_area_id, pickup_address_id,
        (SELECT COUNT(*) FROM warehouses WHERE is_active = 1) AS active_count
      FROM warehouses ORDER BY is_primary DESC, id LIMIT 1`,
    )
    .first<QuotedWarehouse & { active_count?: number }>();
  if (!primary) return undefined;
  const fallback: QuotedWarehouse = {
    id: primary.id,
    origin_area_id: primary.origin_area_id,
    pickup_address_id: primary.pickup_address_id,
  };
  if (!(Number(primary.active_count) > 1)) return fallback;
  const province =
    normalizeProvinceCode(input.destinationProvince) ||
    provinceCodeForCity(input.destinationCity);
  if (!province) return fallback;
  const candidates = await database
    .prepare(
      `SELECT id, is_primary, is_active, origin_area_id, pickup_address_id, province, served_provinces
      FROM warehouses WHERE is_active = 1 ORDER BY id`,
    )
    .all<WarehouseCandidate>();
  const chosen = chooseWarehouse(candidates.results ?? [], province)?.warehouse;
  return chosen
    ? {
        id: chosen.id,
        origin_area_id: String(chosen.origin_area_id ?? ""),
        pickup_address_id: String(chosen.pickup_address_id ?? ""),
      }
    : fallback;
}

export async function resolveEligibleShippingRates(
  database: D1Database,
  locals: App.Locals,
  input: ShippingQuoteInput,
): Promise<ResolvedShippingRates> {
  const destinationId = input.destinationId.trim();
  if (!destinationId) {
    throw new ShippingQuoteError(
      "Pilih kecamatan dari hasil pencarian sebelum menghitung ongkir.",
      "DESTINATION_NOT_RESOLVED",
      422,
    );
  }
  if (input.warehouseOnly) {
    const warehouse = await readQuoteWarehouse(database, input);
    return { originId: warehouse?.origin_area_id?.trim() || "", rates: [], warehouse };
  }

  const quantity =
    Number.isInteger(input.quantity) && Number(input.quantity) > 0
      ? Number(input.quantity)
      : 1;
  let weightKg = (input.fallbackWeightKg || 1) * quantity;
  let quotedVariant: QuotedVariant | undefined;
  if (input.variantKey) {
    const variant = await database
      .prepare(
        `
        SELECT
          pv.weight_grams,
          pv.price,
          pv.title AS variant_title,
          p.title AS product_title
        FROM product_variants pv
        INNER JOIN products p ON p.id = pv.product_id
        WHERE CAST(pv.id AS TEXT) = ?
          AND p.is_active = 1
        LIMIT 1
      `,
      )
      .bind(input.variantKey)
      .first<{
        weight_grams: number;
        price: number;
        variant_title: string;
        product_title: string;
      }>();
    if (!variant) {
      throw new ShippingQuoteError(
        "Varian aktif tidak ditemukan.",
        "VARIANT_NOT_FOUND",
        404,
      );
    }
    const unitWeightKg = Math.max(0.001, Number(variant.weight_grams) / 1000);
    weightKg = unitWeightKg * quantity;
    quotedVariant = {
      productTitle: variant.product_title,
      variantTitle: variant.variant_title,
      unitPrice: Number(variant.price),
      unitWeightKg,
    };
  }

  let warehouse = await readQuoteWarehouse(database, input);

  let originId =
    input.originId?.trim() || warehouse?.origin_area_id?.trim() || "";
  const env = getRuntimeEnv(locals);
  if (!originId) originId = getEnvValue("MENGANTAR_ORIGIN_AREA_ID", env) || "";
  const config = (await getProviderConfig(database, locals)).mengantar;
  if (!originId || !config.apiKey) {
    throw new ShippingQuoteError(
      "Mengantar API atau origin gudang belum dikonfigurasi.",
      "SHIPPING_UNAVAILABLE",
      503,
    );
  }

  const client = new MengantarClient(config.apiKey, config.baseUrl);
  // `COD_AMOUNT` is deliberately not sent on a checkout quote.
  //
  // Mengantar returns its own COD fee when asked, but this store already bills a
  // COD service fee of its own through `payment-fee-policy.ts`, persisted as
  // `cod_service_fee` and `cod_service_fee_vat`. Asking for the provider figure
  // here and adding it to the shipping cost would charge the buyer for the same
  // service twice. The operator's rate checker (`/api/admin/ongkir?cod=`) is the
  // only caller that asks for it, and only to display it.
  //
  // The two figures are not identical: measured against the live account on
  // 2026-08-19, the provider charges exactly one rupiah less than this store's
  // policy at every amount sampled between Rp50.000 and Rp1.000.000. That
  // divergence is recorded in `UNIMPLEMENTED_SPECS.md`, not silently corrected.
  const isCod = input.paymentMethod === "cod";
  const destinationCity = input.destinationCity ?? "";
  const hasCityFallback = isCod && destinationCity.trim() !== "";
  const estimate = (origin: string) =>
    client.estimateRates({ originId: origin, destinationId, weight: weightKg }).then(
      (rates) => ({ rates, error: undefined as unknown }),
      (error: unknown) => ({ rates: [] as CourierRateResult[], error }),
    );
  const [firstEstimate, ruleResult] = await Promise.all([
    estimate(originId),
    database
      .prepare(
        `
        SELECT courier_code, is_enabled, is_cod_enabled
        FROM courier_rules
        ORDER BY id
      `,
      )
      .all<CourierAvailabilityRule>(),
  ]);
  const rules = ruleResult.results ?? [];
  const eligible = (providerRates: CourierRateResult[]) =>
    providerRates
      .filter((rate) =>
        isCourierRateEnabled(rate.courier_code, rules, isCod),
      )
      .filter(
        (rate) =>
          !rate.unsupported && Number.isFinite(rate.price) && rate.price > 0,
      )
      .filter((rate) => !isCod || !rate.unsupported_cod);
  let { rates, error: rateError } = firstEstimate;
  // A branch warehouse whose rate call fails or returns no usable rate hands
  // the quote to the primary before anything else is tried: the primary is
  // the store's default origin. The order records whichever warehouse quoted
  // (`quote.warehouse`), so dispatch and pickup follow it; a rate route and a
  // submit that land on different sides of an outage disagree on price, and
  // submit already refuses that with SHIPPING_QUOTE_CHANGED. A named warehouse
  // (`warehouseId`: the admin re-quote and its preview, a headless echo) is
  // never swapped: the admin save compares no price with its preview, so a
  // silent swap would write another warehouse's cost (REQ-241). It fails, and
  // the operator retries or changes the warehouse.
  let primaryFallbackFrom: number | undefined;
  if (
    warehouse &&
    !input.warehouseId &&
    !input.noPrimaryFallback &&
    !input.originId?.trim() &&
    eligible(rates).length === 0
  ) {
    const primary = await database
      .prepare(
        `SELECT id, origin_area_id, pickup_address_id
        FROM warehouses ORDER BY is_primary DESC, id LIMIT 1`,
      )
      .first<QuotedWarehouse>();
    const primaryOrigin =
      primary?.origin_area_id?.trim() || getEnvValue("MENGANTAR_ORIGIN_AREA_ID", env) || "";
    if (primary && primary.id !== warehouse.id && primaryOrigin) {
      console.warn("shipping-quote-primary-fallback", {
        warehouse_id: warehouse.id,
        primary_id: primary.id,
        reason: rateError ? "error" : "no_rates",
      });
      primaryFallbackFrom = warehouse.id;
      warehouse = {
        id: primary.id,
        origin_area_id: primary.origin_area_id,
        pickup_address_id: primary.pickup_address_id,
      };
      originId = primaryOrigin;
      const branchError = rateError;
      ({ rates, error: rateError } = await estimate(originId));
      // The primary had nothing either: surface the branch's own provider
      // error, as before the fallback, rather than an empty list.
      if (!rateError && eligible(rates).length === 0) rateError = branchError;
    }
  }
  // A failed exact-district estimate used to end a COD checkout even though
  // the city-average fallback below exists for exactly that buyer. Prepaid
  // still fails loudly: it has no fallback (see ICO below).
  if (rateError && !hasCityFallback) throw rateError;
  const fallbackFrom = primaryFallbackFrom ? { primaryFallbackFrom } : {};
  const eligibleRates = eligible(rates);
  // The city-average `ICO` rate is a placeholder the operator replaces with a
  // real courier before dispatch — which the admin allows only for COD. A
  // prepaid buyer who checked out on it paid for an order that could neither
  // be dispatched ("ICO" is no Mengantar courier) nor rerouted, so prepaid
  // gets real rates or none.
  if (eligibleRates.length > 0 || !hasCityFallback) {
    return {
      originId,
      rates: eligibleRates,
      warehouse,
      variant: quotedVariant,
      ...fallbackFrom,
    };
  }

  const cityKey = normalizeCity(destinationCity);
  const candidates = (await client.searchAddress(destinationCity))
    .filter(
      (item) =>
        item._id &&
        item._id !== destinationId &&
        normalizeCity(item.CITY_NAME || "") === cityKey,
    )
    .filter(
      (item, index, all) =>
        all.findIndex((candidate) => candidate._id === item._id) === index,
    )
    .slice(0, 3);
  const sampleResults = await Promise.allSettled(
    candidates.map((candidate) =>
      client.estimateRates({
        originId,
        destinationId: candidate._id,
        weight: weightKg,
      }),
    ),
  );
  const citySamples = sampleResults.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    const cheapest = eligible(result.value)
      .map((rate) => rate.price)
      .sort((left, right) => left - right)[0];
    return cheapest ? [cheapest] : [];
  });
  const fallbackRate = buildCityAverageFallbackRate(citySamples);
  if (!fallbackRate) {
    return { originId, rates: [], warehouse, variant: quotedVariant, ...fallbackFrom };
  }

  return {
    originId,
    warehouse,
    variant: quotedVariant,
    fallbackUsed: true,
    rates: [fallbackRate],
    ...fallbackFrom,
  };
}
