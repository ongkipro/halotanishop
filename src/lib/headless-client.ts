export type HeadlessProductVariant = {
  id: string | number;
  content_id: string;
  label: string;
  price: number;
  compare_price: number;
};

export type HeadlessProduct = {
  id: string | number;
  content_id: string;
  slug: string;
  name: string;
  price: number;
  variants: HeadlessProductVariant[];
};

export type HeadlessShippingRate = {
  courier_code: string;
  courier_service: string;
  price: number;
  estimated_days: string | number | null;
  cod_available: boolean;
  cod_fee: number;
  total_shipping: number;
  /** The rate call's `warehouse_id`; echo it to checkout (multi-warehouse stores). */
  warehouse_id?: number;
};

export type HeadlessCheckoutOrder = {
  id: string | number;
  order_number: string;
  public_status_token: string;
  total_amount: number;
  unit_price: number;
  cod_service_fee: number;
  cod_service_fee_vat: number;
  cod_fee_bearer: "buyer" | "seller";
};

export type HeadlessOrderStatus = {
  is_paid: boolean;
  order_number: string;
  payment_method: string;
  payment_status: string;
  status: string;
  total_amount: number;
  payment: Record<string, unknown> | null;
};
export type HeadlessStorefrontBootstrap = {
  storefront: Record<string, unknown>;
  content: Record<string, unknown>;
  tracking: {
    meta_pixel_id: string | null;
    google_ads_conversion_id: string | null;
    google_ads_conversion_label: string | null;
    google_tag_manager_id: string | null;
  };
  payment: {
    cod_enabled: boolean;
    cod_disabled_provinces: string[];
    supported_methods: string[];
  };
};

export type HeadlessTrackingEventInput = {
  event_name: "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase";
  event_id: string;
  event_source_url: string;
  user_data?: {
    customer_phone?: string;
    customer_name?: string;
    customer_email?: string;
    city?: string;
    province?: string;
    postal_code?: string;
    country?: string;
    external_id?: string;
    fbp?: string;
    fbc?: string;
  };
  custom_data?: {
    content_name?: string;
    content_ids?: string[];
    value?: number;
    currency?: "IDR";
  };
};

export type HeadlessTrackingResult = {
  skipped: boolean;
  deduplicated: boolean;
  delivered: boolean;
  queued: boolean;
  event_id: string | null;
  event_name: string | null;
  reason: string | null;
};


export type HeadlessCheckoutInput = {
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  address: string;
  city?: string;
  district: string;
  province: string;
  postal_code?: string;
  payment_method: "cod" | "bank_transfer" | "qris" | "manual_transfer";
  payment_channel?: string;
  seller_bank_account_id?: number;
  warehouse_id?: number;
  variant_id: string | number;
  quantity: number;
  submit_token: string;
  destination_id: string;
  courier_code: string;
  courier_service_id: number;
  website?: string;
};

type JsonRecord = Record<string, unknown>;
type HeadlessTransport = (request: Request) => Promise<Response>;

export class HeadlessApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireRecord(value: unknown, context: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HeadlessApiError(502, "INVALID_API_RESPONSE", `${context} tidak sesuai kontrak API.`);
  }
  return value as JsonRecord;
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string" || !value) {
    throw new HeadlessApiError(502, "INVALID_API_RESPONSE", `${context} tidak sesuai kontrak API.`);
  }
  return value;
}

function requireNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HeadlessApiError(502, "INVALID_API_RESPONSE", `${context} tidak sesuai kontrak API.`);
  }
  return value;
}

function readApiError(status: number, payload: unknown): HeadlessApiError {
  const envelope = requireRecord(payload, "Error response");
  const error = requireRecord(envelope.error, "Error response.error");
  return new HeadlessApiError(
    status,
    typeof error.code === "string" ? error.code : "API_ERROR",
    typeof error.message === "string" ? error.message : "Headless API request gagal.",
  );
}

export class HeadlessApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly transport: HeadlessTransport;

  constructor(baseUrl: string, apiKey: string, transport: HeadlessTransport = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.transport = transport;
  }

  private async request(path: string, init?: RequestInit): Promise<JsonRecord> {
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    headers.set("x-app-key", this.apiKey);
    if (init?.body) headers.set("content-type", "application/json");
    const response = await this.transport(new Request(`${this.baseUrl}${path}`, { ...init, headers }));
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw readApiError(response.status, payload);
    const envelope = requireRecord(payload, `Response ${path}`);
    if (envelope.success !== true) {
      throw new HeadlessApiError(502, "INVALID_API_RESPONSE", `Response ${path} tidak menandai success.`);
    }
    return envelope;
  }

  async getStorefront(): Promise<HeadlessStorefrontBootstrap> {
    const envelope = await this.request("/storefront");
    const tracking = requireRecord(envelope.tracking, "tracking");
    const payment = requireRecord(envelope.payment, "payment");
    if (
      !Array.isArray(payment.cod_disabled_provinces) ||
      payment.cod_disabled_provinces.some((value) => typeof value !== "string") ||
      !Array.isArray(payment.supported_methods) ||
      payment.supported_methods.some((value) => typeof value !== "string")
    ) {
      throw new HeadlessApiError(502, "INVALID_API_RESPONSE", "payment tidak sesuai kontrak API.");
    }
    const optionalString = (value: unknown, context: string): string | null => {
      if (value === null) return null;
      return requireString(value, context);
    };
    return {
      storefront: requireRecord(envelope.storefront, "storefront"),
      content: requireRecord(envelope.content, "content"),
      tracking: {
        meta_pixel_id: optionalString(tracking.meta_pixel_id, "tracking.meta_pixel_id"),
        google_ads_conversion_id: optionalString(
          tracking.google_ads_conversion_id,
          "tracking.google_ads_conversion_id",
        ),
        google_ads_conversion_label: optionalString(
          tracking.google_ads_conversion_label,
          "tracking.google_ads_conversion_label",
        ),
        google_tag_manager_id: optionalString(
          tracking.google_tag_manager_id,
          "tracking.google_tag_manager_id",
        ),
      },
      payment: {
        cod_enabled: payment.cod_enabled === true,
        cod_disabled_provinces: payment.cod_disabled_provinces,
        supported_methods: payment.supported_methods,
      },
    };
  }

  async listProducts(): Promise<HeadlessProduct[]> {
    const envelope = await this.request("/products");
    if (!Array.isArray(envelope.products)) {
      throw new HeadlessApiError(502, "INVALID_API_RESPONSE", "products tidak sesuai kontrak API.");
    }
    return envelope.products.map((value, productIndex) => {
      const product = requireRecord(value, `products[${productIndex}]`);
      if (!Array.isArray(product.variants)) {
        throw new HeadlessApiError(502, "INVALID_API_RESPONSE", `products[${productIndex}].variants tidak valid.`);
      }
      return {
        id: typeof product.id === "number" ? product.id : requireString(product.id, "product.id"),
        content_id: requireString(product.content_id, "product.content_id"),
        slug: requireString(product.slug, "product.slug"),
        name: requireString(product.name, "product.name"),
        price: requireNumber(product.price, "product.price"),
        variants: product.variants.map((variantValue, variantIndex) => {
          const variant = requireRecord(variantValue, `variants[${variantIndex}]`);
          return {
            id: typeof variant.id === "number" ? variant.id : requireString(variant.id, "variant.id"),
            content_id: requireString(variant.content_id, "variant.content_id"),
            label: requireString(variant.label, "variant.label"),
            price: requireNumber(variant.price, "variant.price"),
            compare_price: requireNumber(variant.compare_price, "variant.compare_price"),
          };
        }),
      };
    });
  }

  async quoteShipping(input: {
    destination_id: string;
    variant_id: string | number;
    quantity: number;
    payment_method: HeadlessCheckoutInput["payment_method"];
  }): Promise<HeadlessShippingRate[]> {
    const envelope = await this.request("/geo/shipping-rates", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!Array.isArray(envelope.rates)) {
      throw new HeadlessApiError(502, "INVALID_API_RESPONSE", "rates tidak sesuai kontrak API.");
    }
    return envelope.rates.map((value, index) => {
      const rate = requireRecord(value, `rates[${index}]`);
      return {
        courier_code: requireString(rate.courier_code, "rate.courier_code"),
        courier_service: requireString(rate.courier_service, "rate.courier_service"),
        price: requireNumber(rate.price, "rate.price"),
        estimated_days:
          typeof rate.estimated_days === "string" || typeof rate.estimated_days === "number"
            ? rate.estimated_days
            : null,
        cod_available: rate.cod_available === true,
        cod_fee: requireNumber(rate.cod_fee, "rate.cod_fee"),
        total_shipping: requireNumber(rate.total_shipping, "rate.total_shipping"),
        ...(typeof envelope.warehouse_id === "number" ? { warehouse_id: envelope.warehouse_id } : {}),
      };
    });
  }

  async checkout(input: HeadlessCheckoutInput): Promise<HeadlessCheckoutOrder> {
    const envelope = await this.request("/checkout", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const order = requireRecord(envelope.order, "order");
    return {
      id: typeof order.id === "number" ? order.id : requireString(order.id, "order.id"),
      order_number: requireString(order.order_number, "order.order_number"),
      public_status_token: requireString(order.public_status_token, "order.public_status_token"),
      total_amount: requireNumber(order.total_amount, "order.total_amount"),
      unit_price: requireNumber(order.unit_price, "order.unit_price"),
      cod_service_fee: requireNumber(order.cod_service_fee, "order.cod_service_fee"),
      cod_service_fee_vat: requireNumber(order.cod_service_fee_vat, "order.cod_service_fee_vat"),
      cod_fee_bearer: order.cod_fee_bearer === "seller" ? "seller" : "buyer",
    };
  }

  async getOrderStatus(orderNumber: string, statusToken: string): Promise<HeadlessOrderStatus> {
    const envelope = await this.request("/orders/status", {
      method: "POST",
      body: JSON.stringify({ order_number: orderNumber, status_token: statusToken }),
    });
    const order = requireRecord(envelope.order, "order");
    return {
      is_paid: order.is_paid === true,
      order_number: requireString(order.order_number, "order.order_number"),
      payment_method: requireString(order.payment_method, "order.payment_method"),
      payment_status: requireString(order.payment_status, "order.payment_status"),
      status: requireString(order.status, "order.status"),
      total_amount: requireNumber(order.total_amount, "order.total_amount"),
      payment: order.payment === null ? null : requireRecord(order.payment, "order.payment"),
    };
  }

  async trackEvent(input: HeadlessTrackingEventInput): Promise<HeadlessTrackingResult> {
    const sourceOrigin = new URL(input.event_source_url).origin;
    const envelope = await this.request("/tracking/events", {
      method: "POST",
      headers: { origin: sourceOrigin },
      body: JSON.stringify(input),
    });
    return {
      skipped: envelope.skipped === true,
      deduplicated: envelope.deduplicated === true,
      delivered: envelope.delivered === true,
      queued: envelope.queued === true,
      event_id: typeof envelope.event_id === "string" ? envelope.event_id : null,
      event_name: typeof envelope.event_name === "string" ? envelope.event_name : null,
      reason: typeof envelope.reason === "string" ? envelope.reason : null,
    };
  }
}

export function focusHeadlessConfirmation(
  root: ParentNode,
  selector = "[data-headless-order-confirmation]",
): boolean {
  const target = root.querySelector<HTMLElement>(selector);
  if (!target) return false;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
  return true;
}

export type HeadlessCheckoutJourneyInput = Omit<
  HeadlessCheckoutInput,
  "variant_id" | "courier_code" | "courier_service_id"
> & {
  product_id: string | number;
  variant_id: string | number;
  preferred_courier_code?: string;
};

export async function runHeadlessCheckoutJourney(
  client: HeadlessApiClient,
  input: HeadlessCheckoutJourneyInput,
): Promise<{
  product: HeadlessProduct;
  variant: HeadlessProductVariant;
  rate: HeadlessShippingRate;
  checkout: HeadlessCheckoutOrder;
  status: HeadlessOrderStatus;
}> {
  const products = await client.listProducts();
  const product = products.find((candidate) => String(candidate.id) === String(input.product_id));
  if (!product) throw new HeadlessApiError(404, "PRODUCT_NOT_FOUND", "Produk tidak ditemukan pada katalog.");
  const variant = product.variants.find((candidate) => String(candidate.id) === String(input.variant_id));
  if (!variant) throw new HeadlessApiError(404, "VARIANT_NOT_FOUND", "Varian tidak ditemukan pada produk.");

  const rates = await client.quoteShipping({
    destination_id: input.destination_id,
    variant_id: variant.id,
    quantity: input.quantity,
    payment_method: input.payment_method,
  });
  const rateIndex = input.preferred_courier_code
    ? rates.findIndex((candidate) => candidate.courier_code === input.preferred_courier_code)
    : 0;
  if (rateIndex < 0 || !rates[rateIndex]) {
    throw new HeadlessApiError(422, "SHIPPING_RATE_NOT_FOUND", "Tarif pengiriman yang dipilih tidak tersedia.");
  }
  const rate = rates[rateIndex];
  const checkout = await client.checkout({
    customer_name: input.customer_name,
    customer_phone: input.customer_phone,
    customer_email: input.customer_email,
    address: input.address,
    city: input.city,
    district: input.district,
    province: input.province,
    postal_code: input.postal_code,
    payment_method: input.payment_method,
    payment_channel: input.payment_channel,
    seller_bank_account_id: input.seller_bank_account_id,
    variant_id: variant.id,
    quantity: input.quantity,
    submit_token: input.submit_token,
    destination_id: input.destination_id,
    courier_code: rate.courier_code,
    courier_service_id: rateIndex + 1,
    warehouse_id: rate.warehouse_id,
    website: input.website,
  });
  const status = await client.getOrderStatus(checkout.order_number, checkout.public_status_token);
  return { product, variant, rate, checkout, status };
}
