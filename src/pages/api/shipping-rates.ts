import type { APIRoute } from "astro";
import { getRuntimeEnv } from "../../lib/env";
import {
  resolveEligibleShippingRates,
  ShippingQuoteError,
} from "../../lib/shipping-quote";
import { checkRateLimit, getClientIp, rateLimitHeaders } from "../../lib/rate-limit";

export const prerender = false;

export const GET: APIRoute = async ({ request, url, locals }) => {
  try {
    const env = getRuntimeEnv(locals);
    const rateLimit = await checkRateLimit(
      env?.OMS_DB as D1Database | undefined,
      `public-shipping-rate:${getClientIp(request.headers)}`,
      60,
      60_000,
    );
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ success: false, error: "Terlalu banyak permintaan ongkir. Coba lagi sebentar." }),
        { status: 429, headers: { "Content-Type": "application/json", ...rateLimitHeaders(rateLimit.remaining, rateLimit.resetAt) } },
      );
    }
    const database = env?.OMS_DB;
    if (!database || typeof database !== "object") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Database konfigurasi belum tersedia",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    const db = database as D1Database;
    const paymentMethod = url.searchParams.get("payment_method") || "";
    const variantKey = String(
      url.searchParams.get("variant_unique_id") ||
        url.searchParams.get("variant_id") ||
        "",
    ).trim();
    const rawWeight = Number(url.searchParams.get("weight") || 0);
    const fallbackWeightKg =
      rawWeight > 100 ? rawWeight / 1000 : rawWeight || 1;
    const rawQuantity = Number(url.searchParams.get("quantity") || 1);
    const quantity =
      Number.isInteger(rawQuantity) && rawQuantity > 0 && rawQuantity <= 100
        ? rawQuantity
        : 1;
    const destinationId =
      url.searchParams.get("destination_id") ||
      url.searchParams.get("location_id");
    if (!destinationId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "destination_id / location_id is required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const { originId, rates: eligibleRates, fallbackUsed } =
      await resolveEligibleShippingRates(db, locals, {
        destinationId,
        destinationCity: url.searchParams.get("city") || undefined,
        paymentMethod,
        variantKey: variantKey || undefined,
        fallbackWeightKg,
        quantity,
        // Admin previews only (order edit, lead conversion): the storefront
        // forms send neither, and their warehouse follows `city` (PRD A42).
        destinationProvince: url.searchParams.get("province") || undefined,
        warehouseId: Number(url.searchParams.get("warehouse_id")) || undefined,
      });
    const items = eligibleRates.map((rate, index) => ({
      courier_service_id: index + 1,
      courier_code: rate.courier_code,
      courier_service: rate.courier_service,
      name: rate.is_fallback ? "ICO · Estimasi rata-rata kota" : rate.courier_code,
      shipment_provider_code: rate.courier_code,
      // See the COD fee note in `shipping-quote.ts`: the provider figure is
      // displayed, never billed here.
      shipping_cost: rate.price,
      estimated_days: rate.estimated_days,
      unsupported: rate.unsupported,
      unsupported_cod: rate.unsupported_cod,
      cod_fee: rate.cod_fee,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        rates: eligibleRates,
        items,
        origin_id: originId,
        fallback_used: Boolean(fallbackUsed),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const quoteError = error instanceof ShippingQuoteError ? error : null;
    if (!quoteError) {
      // The provider's own message is the only thing that says why a quote
      // failed, and MengantarClient already redacts the key out of it. This
      // catch used to drop it, so a store could stop quoting shipping with
      // nothing whatsoever in Workers Logs. Expected ShippingQuoteError
      // conditions stay unlogged; they are buyer-facing states, not faults.
      console.error(
        "shipping-rates",
        error instanceof Error ? error.message : error,
      );
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: quoteError?.message || "Gagal mengambil tarif ongkir",
        code: quoteError?.code || "SHIPPING_PROVIDER_ERROR",
      }),
      {
        status: quoteError?.status || 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
