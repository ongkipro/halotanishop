import { metaNameParts, normalizeMetaText, sha256Hex, toE164Digits } from './meta-identity.ts';
/**
 * Pinned in one place so a bump is a one-line change, never a grep across
 * trackers. Meta ships a version roughly quarterly and retires each after about
 * two years — re-check the changelog before bumping, do not guess:
 * https://developers.facebook.com/docs/graph-api/changelog
 *
 * Verified current on 2026-08-14 (v26.0, released 2026-07-29) and again on
 * 2026-11-01: v26.0 is still the newest, available until a date Meta has not
 * set; v20.0 expired 2026-09-24. Every live install carries v26.0.
 */
export const META_GRAPH_API_VERSION = 'v26.0';

export { toE164Digits } from './meta-identity.ts';

export type MetaUserData = {
  phone?: string;
  name?: string;
  email?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  externalId?: string;
  /** Meta's own cookies. Forwarded raw — hashing them breaks matching. */
  fbp?: string;
  fbc?: string;
  clientIp?: string;
  userAgent?: string;
};

export type MetaCustomData = {
  contentName?: string;
  contentIds?: string[];
  contentType?: string;
  value?: number;
  currency?: string;
  /** Canonical order number. Required for Purchase event deduplication. */
  orderNumber?: string;
};

/** Meta matches on lowercased, punctuation-free text. */
function hashText(value?: string) {
  const cleaned = normalizeMetaText(value);
  return cleaned ? sha256Hex(cleaned) : undefined;
}

function hashEmail(value?: string) {
  const cleaned = value?.trim().toLowerCase();
  return cleaned ? sha256Hex(cleaned) : undefined;
}

function hashPhone(value?: string) {
  const digits = toE164Digits(value);
  return digits ? sha256Hex(digits) : undefined;
}

function hashFirstName(value?: string) {
  const { firstName } = metaNameParts(value);
  return firstName ? sha256Hex(firstName) : undefined;
}

function hashLastName(value?: string) {
  const { lastName } = metaNameParts(value);
  return lastName ? sha256Hex(lastName) : undefined;
}

function cleanRawSignal(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function cleanClientIp(value?: string): string | undefined {
  const cleaned = cleanRawSignal(value);
  return cleaned?.toLowerCase() === 'unknown' ? undefined : cleaned;
}

export function resolveMetaEventId(
  eventName: string,
  eventId: string,
  orderNumber?: string,
): string | undefined {
  const resolved = eventName === 'Purchase' ? orderNumber : eventId;
  return cleanRawSignal(resolved);
}

function readMetaErrorMessage(responseBody: unknown): string | undefined {
  if (!responseBody || typeof responseBody !== 'object' || !('error' in responseBody)) return undefined;
  const error = responseBody.error;
  if (!error || typeof error !== 'object' || !('message' in error)) return undefined;
  return typeof error.message === 'string' && error.message.trim() ? error.message : undefined;
}

export async function sendMetaCapiEvent(
  eventName: string,
  eventId: string,
  eventSourceUrl: string,
  userData: MetaUserData,
  customData: MetaCustomData,
  pixelId?: string,
  accessToken?: string,
  testEventCode?: string,
  /** Unix seconds the event happened; a retry must not restamp it as now. */
  eventTime?: number,
): Promise<{
  success: boolean;
  response?: unknown;
  reason?: string;
}> {
  const resolvedEventId = resolveMetaEventId(eventName, eventId, customData.orderNumber);
  if (!resolvedEventId) {
    return {
      success: false,
      reason: eventName === 'Purchase'
        ? 'Purchase membutuhkan order_number sebagai event_id.'
        : 'Meta event_id tidak boleh kosong.',
    };
  }

  const clientIp = cleanClientIp(userData.clientIp);
  const userAgent = cleanRawSignal(userData.userAgent);
  const fbp = cleanRawSignal(userData.fbp);
  const fbc = cleanRawSignal(userData.fbc);
  const orderNumber = cleanRawSignal(customData.orderNumber);
  const targetPixelId = pixelId || import.meta.env.META_PIXEL_ID;
  const targetToken = accessToken || import.meta.env.META_CAPI_ACCESS_TOKEN;

  if (!targetPixelId || !targetToken) {
    return { success: false, reason: 'META_PIXEL_ID or META_CAPI_ACCESS_TOKEN not set' };
  }

  const [ph, em, fn, ln, ct, st, zp, country, external_id] = await Promise.all([
    hashPhone(userData.phone),
    hashEmail(userData.email),
    hashFirstName(userData.name),
    hashLastName(userData.name),
    hashText(userData.city),
    hashText(userData.province),
    hashText(userData.postalCode),
    hashText(userData.country),
    hashText(userData.externalId),
  ]);

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: eventTime ?? Math.floor(Date.now() / 1000),
        event_id: resolvedEventId,
        event_source_url: eventSourceUrl,
        action_source: 'website',
        user_data: {
          ph: ph ? [ph] : undefined,
          em: em ? [em] : undefined,
          fn: fn ? [fn] : undefined,
          ln: ln ? [ln] : undefined,
          ct: ct ? [ct] : undefined,
          st: st ? [st] : undefined,
          zp: zp ? [zp] : undefined,
          country: country ? [country] : undefined,
          external_id: external_id ? [external_id] : undefined,
          fbp,
          fbc,
          client_ip_address: clientIp,
          client_user_agent: userAgent,
        },
        custom_data: {
          content_name: customData.contentName,
          content_ids: customData.contentIds,
          content_type: customData.contentType || 'product',
          value: customData.value,
          currency: customData.currency || 'IDR',
          order_id: orderNumber,
        },
      },
    ],
    test_event_code: testEventCode || undefined,
  };

  const endpoint = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${targetPixelId}/events?access_token=${targetToken}`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responseBody: unknown = await response.json().catch(() => null);
    const errorMessage = readMetaErrorMessage(responseBody);
    return {
      success: response.ok,
      response: responseBody,
      reason: response.ok
        ? undefined
        : errorMessage || `Meta CAPI HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : 'Meta CAPI network error.',
    };
  }
}

/**
 * Whether an ID the operator typed is actually a Pixel/Dataset. `^\d{5,25}$`
 * accepts a Business Manager, Page or Ad Account ID just as happily, and
 * saving one of those kills the browser Pixel and the Conversions API
 * together, silently — an install lost a day of signal that way on
 * 2026-09-03. Asking Meta for a field only an AdsPixel node carries settles
 * it while the operator is still on the screen.
 */
export type MetaPixelIdentity =
  | { state: "pixel"; name?: string }
  | { state: "not-a-pixel"; name?: string }
  | { state: "unknown"; reason: string };

/** Present only on an AdsPixel node, and cheap to ask for. */
const PIXEL_ONLY_FIELD = "last_fired_time";

export async function verifyMetaPixelIdentity(
  pixelId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaPixelIdentity> {
  const ask = async (fields: string) => {
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${pixelId}`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("access_token", accessToken);
    const response = await fetchImpl(url);
    return {
      ok: response.ok,
      body: (await response.json().catch(() => null)) as {
        name?: string;
        error?: { code?: number; error_subcode?: number; message?: string };
      } | null,
    };
  };

  try {
    const probe = await ask(`id,name,${PIXEL_ONLY_FIELD}`);
    if (probe.ok) return { state: "pixel", name: probe.body?.name };

    const error = probe.body?.error;
    if (error?.code !== 100) {
      return { state: "unknown", reason: error?.message ?? "Meta tidak memberi jawaban yang dikenali." };
    }
    // Subcode 33 is "cannot be loaded", which a missing asset permission also
    // produces. Refusing on it would block a correct ID behind a fixable
    // permission problem.
    if (error.error_subcode === 33) {
      return { state: "unknown", reason: error.message ?? "Objek tidak terjangkau oleh token ini." };
    }
    if (!/nonexisting field/i.test(error.message ?? "")) {
      return { state: "unknown", reason: error.message ?? "Meta menolak pemeriksaan ID." };
    }
    // The object resolves and is not a pixel. Name it if Meta will say.
    const named = await ask("id,name");
    return { state: "not-a-pixel", name: named.ok ? named.body?.name : undefined };
  } catch (error) {
    return {
      state: "unknown",
      reason: error instanceof Error ? error.message : "Pemeriksaan ID gagal dihubungi.",
    };
  }
}
