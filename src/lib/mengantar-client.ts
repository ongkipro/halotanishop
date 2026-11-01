export type MengantarEstimateInput = {
  originId: string; // area _id
  destinationId: string; // area _id
  courier?: string; // default "all"
  weight?: number; // kg
  codAmount?: number;
};

export type CourierRateResult = {
  courier_code: string;
  courier_service: string;
  price: number;
  estimated_days: string;
  unsupported: boolean;
  unsupported_cod: boolean;
  cod_fee: number;
  is_fallback?: boolean;
};

export type MengantarAddressSearchResult = {
  _id: string;
  DISTRICT_NAME?: string;
  SUBDISTRICT_NAME?: string;
  CITY_NAME?: string;
  PROVINCE_NAME?: string;
  ZIP_CODE?: string;
};

export type MengantarPickupAddressInput = {
  addressId?: string;
  pickupName: string;
  pickupPic: string;
  pickupPicPhone: string;
  pickupAddress: string;
  pickupAutofill: string;
};

export type MengantarPickupAddress = {
  _id: string;
  PICKUP_NAME?: string;
  PICKUP_PIC?: string;
  PICKUP_PIC_PHONE?: string;
  PICKUP_ADDRESS?: string;
  PICKUP_AUTOFILL?: unknown;
};

export type MengantarPickupTimeInput = {
  addressId: string; // _id pickup address from GET /address
  date: string; // Format mm-dd-yyyy (e.g. 08-07-2026)
  time: string; // One-hour slot "9:00" … "18:00" (Mengantar docs, POST /time)
};

/** A pickup slot as `/time` answers it. */
export type MengantarPickupTime = { _id: string; date: string; time: string };

type MengantarApiResponse<T> = {
  success?: boolean;
  data?: T;
  message?: string;
};

export type MengantarTrackingHistory = {
  desc?: string;
  date?: string;
  [key: string]: unknown;
};

export type MengantarOrderTracking = {
  cnote_no?: string | null;
  ORDER_ID?: string;
  courier?: string;
  status?: string;
  history?: readonly MengantarTrackingHistory[];
  [key: string]: unknown;
};

export type ProviderShippingStatus =
  | "processing"
  | "shipped"
  | "delivered"
  | "returned";

export type MengantarStatusEvidence = {
  shippingStatus: ProviderShippingStatus;
  description: string | null;
  occurredAt: string | null;
};


const normalizeProviderTimestamp = (value: string | null): string | null => {
  if (!value) return null;
  const jakarta = value
    .trim()
    .match(
      /^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s+Asia\/Jakarta)?$/,
    );
  if (jakarta) {
    const [, day, month, year, hour, minute, second = "0"] = jakarta;
    const calendar = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ),
    );
    if (
      calendar.getUTCFullYear() !== Number(year) ||
      calendar.getUTCMonth() !== Number(month) - 1 ||
      calendar.getUTCDate() !== Number(day) ||
      calendar.getUTCHours() !== Number(hour) ||
      calendar.getUTCMinutes() !== Number(minute)
    ) {
      return null;
    }
    return new Date(calendar.getTime() - 7 * 60 * 60 * 1000).toISOString();
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
};

function latestTrackingHistory(
  history: readonly MengantarTrackingHistory[],
): { description: string | null; occurredAt: string | null } | null {
  const events = history
    .filter(
      (event): event is MengantarTrackingHistory =>
        Boolean(event) && typeof event === "object",
    )
    .map((event, index) => {
      const description =
        typeof event.desc === "string" && event.desc.trim()
          ? event.desc.trim()
          : null;
      const date =
        typeof event.date === "string" && event.date.trim()
          ? event.date.trim()
          : null;
      return {
        description,
        occurredAt: normalizeProviderTimestamp(date),
        index,
      };
    })
    .filter((event) => event.description || event.occurredAt);
  if (events.length === 0) return null;

  const timestamped = events.filter((event) => event.occurredAt);
  if (timestamped.length > 0) {
    timestamped.sort((left, right) => {
      const timeDifference =
        Date.parse(right.occurredAt!) - Date.parse(left.occurredAt!);
      return timeDifference || left.index - right.index;
    });
    return timestamped[0];
  }
  return events[0];
}

function activeMengantarStatusFlags(status: string | undefined): string[] {
  if (!status) return [];
  try {
    const parsed = JSON.parse(status) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed)
      .filter(([, active]) => active === true)
      .map(([flag]) =>
        flag
          .normalize("NFKD")
          .replace(/[^\p{L}\p{N}]+/gu, "_")
          .toUpperCase(),
      );
  } catch {
    return [];
  }
}

/**
 * Converts only Mengantar's active status flags into the local lifecycle while
 * retaining the latest raw history description and provider event time.
 */
export function mapMengantarStatusEvidence(
  tracking: MengantarOrderTracking,
): MengantarStatusEvidence {
  const latest = latestTrackingHistory(
    Array.isArray(tracking.history) ? tracking.history : [],
  );
  const flags = activeMengantarStatusFlags(tracking.status);
  let shippingStatus: ProviderShippingStatus = "processing";
  if (
    flags.some(
      (flag) =>
        flag === "RTS" ||
        flag === "RETURNED" ||
        flag === "RETURN_TO_SENDER" ||
        flag.startsWith("RTS_") ||
        flag.startsWith("RETURNED_"),
    )
  ) {
    shippingStatus = "returned";
  } else if (
    flags.some(
      (flag) =>
        flag === "DELIVERED" ||
        flag === "DELIVERED_COMPLETE" ||
        flag === "DELIVERY_COMPLETE",
    )
  ) {
    shippingStatus = "delivered";
  } else if (
    flags.some((flag) =>
      [
        "PICKUP",
        "PICKED_UP",
        "PICKUP_COMPLETE",
        "PICKUP_COMPLETED",
        "COLLECTED",
        "SHIPPED",
        "IN_TRANSIT",
        "TRANSIT",
        "OUT_FOR_DELIVERY",
        "MANIFESTED",
      ].includes(flag),
    )
  ) {
    shippingStatus = "shipped";
  }

  return {
    shippingStatus,
    description: latest?.description || null,
    occurredAt: latest?.occurredAt || null,
  };
}

const PROVIDER_STATUS_RANK: Record<ProviderShippingStatus | "pending", number> = {
  pending: 0,
  processing: 1,
  shipped: 2,
  delivered: 3,
  returned: 3,
};

export function selectProviderShippingAdvance(
  currentStatus: string,
  evidenceStatus: ProviderShippingStatus,
): ProviderShippingStatus | null {
  if (["delivered", "returned", "cancelled"].includes(currentStatus)) return null;
  const currentRank =
    PROVIDER_STATUS_RANK[
      currentStatus as keyof typeof PROVIDER_STATUS_RANK
    ];
  if (currentRank === undefined) return null;
  return PROVIDER_STATUS_RANK[evidenceStatus] > currentRank
    ? evidenceStatus
    : null;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function redactMengantarApiKey(message: string, apiKey: string): string {
  if (!apiKey) return message;
  let sanitized = message;
  for (const secret of [apiKey, encodeURIComponent(apiKey)]) {
    if (secret) sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  return sanitized;
}
export function getActualMengantarRatePrice(
  item: Record<string, unknown>,
): number | null {
  const price = Number(item.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

const normalizePickupValue = (value: unknown) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("id-ID");

const normalizePickupPhone = (value: unknown) =>
  String(value || "").replace(/\D/g, "");

export function selectMengantarPickupAddress(
  addresses: readonly MengantarPickupAddress[],
  input: MengantarPickupAddressInput,
) {
  const requestedId = input.addressId?.trim();
  if (requestedId) {
    const byId = addresses.find((address) => address._id === requestedId);
    if (byId) return byId;
  }

  const expectedName = normalizePickupValue(input.pickupName);
  const expectedPhone = normalizePickupPhone(input.pickupPicPhone);
  const expectedAddress = normalizePickupValue(input.pickupAddress);
  return addresses.find(
    (address) =>
      normalizePickupValue(address.PICKUP_NAME) === expectedName &&
      normalizePickupPhone(address.PICKUP_PIC_PHONE) === expectedPhone &&
      normalizePickupValue(address.PICKUP_ADDRESS) === expectedAddress,
  );
}

export function extractMengantarPickupAddressId(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["_id", "address_id", "id"]) {
    const candidate = String(record[key] || "").trim();
    if (candidate) return candidate;
  }
  return "";
}


const POS_COD_BLOCK_REASONS = {
  new_seller: "akun belum punya riwayat pengiriman",
  insufficient: "data pengiriman akun belum cukup untuk dinilai",
  blocked: "tiga periode evaluasi terakhir di bawah ambang",
} as const;

/**
 * Mengantar refuses a COD `pos` order with 403 when the account's delivered
 * rate is under its threshold (82%, rolling 21-60 days, all couriers). The
 * three blocked statuses share one message; `status` tells them apart. The
 * quote does not reveal this, so the refusal only surfaces at create-order.
 */
export class MengantarPosCodIneligibleError extends Error {
  readonly status: keyof typeof POS_COD_BLOCK_REASONS;
  readonly deliveredRate: number | null;
  readonly minimumDeliveredRate: number | null;

  constructor(
    status: keyof typeof POS_COD_BLOCK_REASONS,
    deliveredRate: number | null,
    minimumDeliveredRate: number | null,
  ) {
    const rate =
      deliveredRate === null
        ? ""
        : `, delivered rate ${deliveredRate}%${minimumDeliveredRate === null ? "" : ` < ${minimumDeliveredRate}%`}`;
    super(
      `COD Pos Indonesia diblokir Mengantar untuk akun ini (${POS_COD_BLOCK_REASONS[status]}${rate}). ` +
        "COD Pos dimatikan di pengaturan ekspedisi; ganti kurir atau jadikan non-COD, lalu dispatch ulang.",
    );
    this.name = "MengantarPosCodIneligibleError";
    this.status = status;
    this.deliveredRate = deliveredRate;
    this.minimumDeliveredRate = minimumDeliveredRate;
  }
}

function posCodIneligibility(httpStatus: number, payload: Record<string, unknown>) {
  const status = payload.status;
  if (httpStatus !== 403 || typeof status !== "string" || !Object.hasOwn(POS_COD_BLOCK_REASONS, status)) {
    return null;
  }
  const rate = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return new MengantarPosCodIneligibleError(
    status as keyof typeof POS_COD_BLOCK_REASONS,
    rate(payload.deliveredRate),
    rate(payload.minimumDeliveredRate),
  );
}

/**
 * 403 "Not allowed": the endpoint is limited to accounts Mengantar has
 * whitelisted (Receiver Score and Courier Performance, per the provider docs).
 * Access is granted by Mengantar CS, never by a retry or a new key.
 */
/**
 * The request may have been carried out, and nothing says whether it was: a
 * timeout, a dropped connection, a provider 5xx, or a 2xx whose body cannot be
 * read (audit 2026-10-31 M-1). For `POST /order` it means a shipment may exist
 * at Mengantar, so the order must not be pushed again blindly.
 */
export class MengantarOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MengantarOutcomeUnknownError";
  }
}

export class MengantarNotWhitelistedError extends Error {
  /** `detail` names the feature and the key that was refused, when the caller knows them. */
  constructor(detail?: string) {
    super(
      detail ??
        'Akses Mengantar untuk fitur ini belum aktif: akun belum di-whitelist. Minta akses ke CS Mengantar.',
    );
    this.name = 'MengantarNotWhitelistedError';
  }
}

export class MengantarClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(apiKey: string, baseUrl = 'https://api-public.mengantar.com', timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  private get prefixUrl(): string {
    return `${this.baseUrl}/api/public/${this.apiKey}`;
  }

  private async requestJson<T>(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (!headers.has("x-client-source")) {
      headers.set("x-client-source", "directCall");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.prefixUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const raw = await res.text();
      let payload: MengantarApiResponse<T> = {};

      if (raw.trim()) {
        try {
          payload = JSON.parse(raw) as MengantarApiResponse<T>;
        } catch {
          const message = 'Mengantar API mengembalikan respons yang tidak valid.';
          throw res.ok || res.status >= 500 ? new MengantarOutcomeUnknownError(message) : new Error(message);
        }
      }

      const message = typeof payload.message === 'string' && payload.message.trim() ? payload.message.trim() : '';
      if (!res.ok) {
        const posCod = posCodIneligibility(res.status, payload as Record<string, unknown>);
        if (posCod) throw posCod;
        if (res.status === 403 && message === 'Not allowed') throw new MengantarNotWhitelistedError();
        // A 5xx says nothing about whether the provider acted before failing.
        if (res.status >= 500) throw new MengantarOutcomeUnknownError(message || `Mengantar API gagal (${res.status}).`);
        throw new Error(message || `Mengantar API gagal (${res.status}).`);
      }
      if (payload.success === false) {
        throw new Error(message || 'Mengantar API menolak permintaan.');
      }

      return payload;
    } catch (error) {
      // Built only from provider fields we allowlist, never from the URL.
      if (error instanceof MengantarPosCodIneligibleError) throw error;
      if (error instanceof MengantarNotWhitelistedError) throw error;
      if (error instanceof MengantarOutcomeUnknownError) {
        throw new MengantarOutcomeUnknownError(redactMengantarApiKey(error.message, this.apiKey));
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MengantarOutcomeUnknownError('Mengantar API timeout.');
      }
      // fetch rejects with a TypeError when the connection fails mid-request.
      if (error instanceof TypeError) {
        throw new MengantarOutcomeUnknownError(
          redactMengantarApiKey(error.message, this.apiKey) || 'Koneksi ke Mengantar API terputus.',
        );
      }
      if (error instanceof Error) {
        const sanitizedMessage = redactMengantarApiKey(error.message, this.apiKey);
        throw new Error(sanitizedMessage || 'Gagal menghubungi Mengantar API.');
      }
      throw new Error('Gagal menghubungi Mengantar API.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Search Area for origin_id and destination_id
   */
  async searchAddress(keyword: string): Promise<MengantarAddressSearchResult[]> {
    const query = new URLSearchParams({ keyword });
    const json = await this.requestJson<MengantarAddressSearchResult[]>(
      `/address/search?${query.toString()}`,
    );
    return Array.isArray(json.data) ? json.data : [];
  }

  /**
   * List Registered Pickup Addresses (GET /address)
   */
  async getPickupAddresses(): Promise<MengantarPickupAddress[]> {
    const json = await this.requestJson<MengantarPickupAddress[]>("/address");
    return Array.isArray(json.data) ? json.data : [];
  }

  /**
   * Create or update a pickup address. Omitting `_id` lets Mengantar assign it.
   */
  async createPickupAddress(input: MengantarPickupAddressInput) {
    const formData = new URLSearchParams();
    if (input.addressId) formData.append("_id", input.addressId);
    formData.append("PICKUP_NAME", input.pickupName);
    formData.append("PICKUP_PIC", input.pickupPic);
    formData.append("PICKUP_PIC_PHONE", input.pickupPicPhone);
    formData.append("PICKUP_ADDRESS", input.pickupAddress);
    formData.append("PICKUP_AUTOFILL", input.pickupAutofill);

    const json = await this.requestJson<Record<string, unknown>>("/address", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });
    return json.data && typeof json.data === "object" ? json.data : {};
  }

  async ensurePickupAddress(input: MengantarPickupAddressInput) {
    const addresses = await this.getPickupAddresses();
    const existing = selectMengantarPickupAddress(addresses, input);
    const saved = await this.createPickupAddress({
      ...input,
      addressId: existing?._id,
    });
    const savedId = extractMengantarPickupAddressId(saved);
    if (savedId) return savedId;
    if (existing?._id) return existing._id;

    const created = selectMengantarPickupAddress(
      await this.getPickupAddresses(),
      { ...input, addressId: undefined },
    );
    if (created?._id) return created._id;
    throw new Error(
      "Mengantar menerima alamat pickup tetapi tidak mengembalikan ID alamat.",
    );
  }

  /**
   * Schedule Pickup Time Slot (POST /time)
   */
  async schedulePickupTime(input: MengantarPickupTimeInput) {
    const formData = new URLSearchParams();
    formData.append('address_id', input.addressId);
    formData.append('date', input.date); // mm-dd-yyyy
    formData.append('time', input.time); // "13:00"

    // POST answers one slot object, GET an array (Mengantar docs); read with pickMengantarTimeId.
    return await this.requestJson<MengantarPickupTime | MengantarPickupTime[]>('/time', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
  }

  /**
   * List Scheduled Pickup Times for an Address (GET /time?address=)
   */
  async getPickupTimes(addressId: string) {
    const query = new URLSearchParams({ address: addressId });
    return await this.requestJson<MengantarPickupTime[]>(`/time?${query.toString()}`);
  }

  /**
   * Estimate Shipping Rates across all couriers
   */
  async estimateRates(input: MengantarEstimateInput): Promise<CourierRateResult[]> {
    const originId = input.originId.trim();
    const destinationId = input.destinationId.trim();
    if (!originId || !destinationId) {
      throw new Error('Area asal dan tujuan Mengantar wajib dipilih dari hasil pencarian provider.');
    }

    const query = new URLSearchParams({
      origin_id: originId,
      destination_id: destinationId,
      courier: input.courier || 'all',
      weight: String(input.weight || 1),
    });

    if (input.codAmount) {
      query.append('COD_AMOUNT', String(input.codAmount));
    }

    const json = await this.requestJson<Record<string, unknown>>(`/order/estimate?${query.toString()}`);

    const results: CourierRateResult[] = [];
    if (json.data && typeof json.data === 'object') {
      // /order/estimate?courier=all returns an object keyed by courier name, not an array.
      // Single courier returns a flat object (no key wrapper).
      const entries =
        input.courier && input.courier !== 'all'
          ? [[input.courier, json.data] as const]
          : Object.entries(json.data);

      for (const [courierKey, rateData] of entries) {
        if (!rateData || typeof rateData !== 'object') continue;
        // Skip Cargo services — these are bulk/heavy freight, not consumer-facing
        if (/cargo/i.test(courierKey)) continue;
        const item = rateData as Record<string, unknown>;

        // SPX reports an origin it cannot pick up from separately from
        // `unsupported` (observed live 2026-09-25, undocumented).
        const isUnsupported = Boolean(item.unsupported || item.unsupportedOriginSpx);
        // `price` is the public courier charge. Never bill Mengantar's
        // `estimatedSpecialPrice`, which is the integrator discount.
        const rawPrice = getActualMengantarRatePrice(item);
        if (isUnsupported || rawPrice === null) continue;

        results.push({
          courier_code: courierKey,
          courier_service: courierKey,
          price: rawPrice,
          // /order/estimate does NOT return ETD — only /allEstimatePublic has estimatedDate.
          // Use estimate_delivery (from allEstimatePublic response) or estimatedDate if present,
          // otherwise leave empty to signal "not available" to the UI.
          estimated_days: String(item.estimate_delivery || item.estimatedDate || ''),
          unsupported: isUnsupported,
          unsupported_cod: Boolean(item.unsupported_cod || item.coverage_cod === false),
          cod_fee: Number(item.codFee || 0),
        });
      }
    }

    return results;
  }

  /**
   * Return the receiver's per-courier delivery history.
   */
  async getReceiverPerformance(phone: string) {
    const cleanPhone = phone.replace(/\D/g, '');
    const query = new URLSearchParams({ search: cleanPhone });
    const json = await this.requestJson<Record<string, unknown>>(`/getReceiverScoreByNumberUser?${query.toString()}`);
    return json.data && typeof json.data === 'object' ? json.data : {};
  }

  /**
   * Look up one shipment and its tracking history by provider waybill.
   */
  async getOrderByTrackingId(
    trackingId: string,
  ): Promise<MengantarOrderTracking> {
    const normalizedTrackingId = trackingId.trim();
    if (!normalizedTrackingId) {
      throw new Error("Nomor resi Mengantar wajib diisi.");
    }
    const query = new URLSearchParams({ tracking_id: normalizedTrackingId });
    const json = await this.requestJson<MengantarOrderTracking[]>(
      `/order?${query.toString()}`,
    );
    const tracking = Array.isArray(json.data) ? json.data[0] : null;
    if (!tracking || typeof tracking !== "object") {
      throw new Error("Data tracking Mengantar tidak ditemukan.");
    }
    return tracking;
  }


  /**
   * Submit Order / Resi Generation to Mengantar API
   */
  async createShipment(orderPayload: Record<string, unknown>) {
    return await this.requestJson<Record<string, unknown>>('/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    });
  }
  /**
   * Complete payment for unpaid orders after wallet top-up (POST /order/pay-unpaid)
   */
  async payUnpaidOrder(batchId: string, courierCode: string) {
    return await this.requestJson<Record<string, unknown>>('/order/pay-unpaid', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        batch_id: batchId,
        courier: courierCode,
      }),
    });
  }
}
