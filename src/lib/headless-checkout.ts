import { selectQuotedRate } from './courier-rules.ts';
import type { OrderSubmitInput } from './order-schema.ts';
import { provinceCodeForCity } from './warehouse-choice.ts';

export type ShippingQuoteFailure = Error & {
  code: string;
  status: number;
};

export type TrustedHeadlessShipping = {
  destinationId: string;
  shippingCost: number;
  courierCode: string;
  courierService: string;
  warehouseId?: number;
};

type QuoteResolver = (input: {
  destinationId: string;
  paymentMethod: string;
  variantKey?: string;
  quantity?: number;
  warehouseId?: number;
  destinationProvince?: string;
  warehouseOnly?: boolean;
  noPrimaryFallback?: boolean;
}) => Promise<{
  rates: Array<{
    courier_code: string;
    courier_service: string;
    price: number;
    estimated_days: string;
    unsupported: boolean;
    unsupported_cod: boolean;
    cod_fee: number;
  }>;
  warehouse?: {
    id: number;
  };
}>;

export function isShippingQuoteFailure(error: unknown): error is ShippingQuoteFailure {
  if (!(error instanceof Error)) return false;
  const maybeCode = Reflect.get(error, 'code');
  const maybeStatus = Reflect.get(error, 'status');
  return typeof maybeCode === 'string' && typeof maybeStatus === 'number';
}

function createShippingQuoteFailure(
  message: string,
  code: string,
  status: number,
): ShippingQuoteFailure {
  const error = new Error(message) as ShippingQuoteFailure;
  error.code = code;
  error.status = status;
  return error;
}

export async function resolveTrustedHeadlessShipping(
  body: Record<string, unknown>,
  data: OrderSubmitInput,
  quoteResolver: QuoteResolver,
): Promise<TrustedHeadlessShipping> {
  const destinationId = String(body.location_id || body.destination_id || '').trim();
  const courierCode = String(body.shipment_provider_code || body.courier_code || '').trim();
  const courierServiceId = Number(body.courier_service_id || 1);
  if (!destinationId || !courierCode) {
    throw createShippingQuoteFailure(
      'destination_id dan courier_code wajib diisi untuk checkout headless.',
      'SHIPPING_QUOTE_REQUIRED',
      422,
    );
  }

  // Re-quote with exactly what the rate call had (PRD A42): the destination
  // and the `warehouse_id` it returned. `city` does not choose the warehouse:
  // a client that quoted without one was shown the primary's price, and
  // choosing by the checkout's city would charge it another warehouse's.
  const quotedWarehouseId = Number(body.warehouse_id);
  const warehouseId =
    Number.isSafeInteger(quotedWarehouseId) && quotedWarehouseId > 0 ? quotedWarehouseId : undefined;
  const quoteInput = {
    destinationId,
    paymentMethod: data.payment_method,
    variantKey: data.variant_id,
    quantity: data.quantity,
    warehouseId,
    // Nothing here compares a submitted shipping cost, so a quote must never
    // move to the primary behind the buyer's back.
    noPrimaryFallback: true,
  };
  // With no `warehouse_id` echoed, checkout cannot tell whether the rate call
  // carried `city` (warehouse chosen by province) or not (primary). Ask which
  // warehouse that city would choose (no rate call); only when it is not the
  // primary, quote from it too. If the two disagree on the chosen rate's
  // price, either may be a price the buyer was not shown, so refuse instead of
  // guessing (audit finding 23). A one-warehouse store always agrees and makes
  // the one rate call it made before A42. A failed extra quote throws, never
  // falls back to the primary's price.
  const cityProvince = warehouseId ? '' : provinceCodeForCity(String(body.city || ''));
  const [quote, cityChoice] = await Promise.all([
    quoteResolver(quoteInput),
    cityProvince
      ? quoteResolver({ ...quoteInput, destinationProvince: cityProvince, warehouseOnly: true })
      : undefined,
  ]);
  // `?? null` so a store with no warehouse rows (env origin) compares equal:
  // Number(undefined) is NaN, and NaN never equals itself.
  if (cityChoice && (cityChoice.warehouse?.id ?? null) !== (quote.warehouse?.id ?? null)) {
    const cityQuote = await quoteResolver({ ...quoteInput, destinationProvince: cityProvince });
    const shown = selectQuotedRate(cityQuote.rates, courierCode, courierServiceId);
    const charged = selectQuotedRate(quote.rates, courierCode, courierServiceId);
    if (shown && charged && shown.price !== charged.price) {
      throw createShippingQuoteFailure(
        'Ongkir berbeda per gudang. Kirim warehouse_id dari tarif yang dipilih lalu coba lagi.',
        'SHIPPING_QUOTE_CHANGED',
        409,
      );
    }
  }
  // The quoted warehouse is no longer active or ready: its price is not what
  // this order would be charged, so the client must re-quote.
  if (warehouseId && Number(quote.warehouse?.id) !== warehouseId) {
    throw createShippingQuoteFailure(
      'Gudang pengiriman berubah. Muat ulang ongkir lalu coba lagi.',
      'SHIPPING_QUOTE_CHANGED',
      409,
    );
  }
  const rate = selectQuotedRate(quote.rates, courierCode, courierServiceId);
  if (!rate) {
    throw createShippingQuoteFailure(
      'Tarif pengiriman yang dipilih tidak lagi tersedia. Muat ulang ongkir lalu coba lagi.',
      'SHIPPING_RATE_NOT_FOUND',
      422,
    );
  }

  return {
    destinationId,
    // Provider `cod_fee` is not added: `persistOrder` adds the store's own COD
    // service fee (see the COD fee note in `shipping-quote.ts`), exactly as
    // storefront checkout does, so folding it in here charged it twice.
    shippingCost: rate.price,
    courierCode: rate.courier_code,
    courierService: rate.courier_service,
    warehouseId: quote.warehouse?.id ? Number(quote.warehouse.id) : undefined,
  };
}
