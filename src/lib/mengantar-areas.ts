/**
 * Kecamatan → Mengantar area, stored in D1 for good (PRD A43, REQ-243).
 *
 * The form resolves the district it picked from the bundled catalogue to a
 * Mengantar area id once (`/api/locations?level=resolve`). That answer used
 * to sit in KV for 24 hours, so every district cost a Mengantar search and a
 * KV write again each day. It is now one row per district|city|province,
 * read before Mengantar is asked. A row older than
 * `MENGANTAR_AREA_MAX_AGE_DAYS` is treated as a miss and resolved again, so a
 * renamed or retired area heals within that bound; dropping a row the moment
 * Mengantar refuses it (`dropMengantarArea`, REQ-244) waits on A-415's
 * approval because it touches the quote and dispatch.
 *
 * Only an exact district match is stored. When Mengantar does not know the
 * catalogue's district and the answer is a fallback (a migrated kelurahan or
 * a same-city alternative), it is returned to the form but not kept: a guess
 * stored for a month would outlive the provider fixing its catalogue. A
 * stale row whose re-resolve is a fallback or empty is deleted, not kept.
 *
 * Rows come from two places (`source`):
 * - `resolve`: a live resolve. `payload` holds the exact body the route
 *   returned, and a hit returns it byte for byte (REQ-247).
 * - `order-history`: seeded by migration `_mengantar_areas.sql` from the
 *   store's own orders, the most frequent `destination_area_id` per district.
 *   An order cannot tell an exact match from a fallback, so the row is dated
 *   by its newest order, not the migration: it answers only until the bound
 *   runs out from the last time a live resolve gave a buyer that id, and its
 *   re-resolve either stores an exact answer or deletes it.
 *   There is no provider body to replay, so a hit is composed from the
 *   request's own district, city and province with the stored id and postal
 *   code — the fields the form reads (`form-hybrid.ts`: `items[0]`'s
 *   `location_id` and `postal_code`).
 */
import {
  fetchProviderLocations,
  providerLocation,
  resolveProviderDestinations,
  type ProviderAddressRow,
  type ProviderLocationsPayload,
} from "./location-search.ts";

// Trimmed and lower-cased per part. The seed in the migration mirrors it as
// lower(trim(...)), which agrees for every ASCII name.
const normalizeKeyPart = (value: string) => value.trim().toLocaleLowerCase("id-ID");

export function buildMengantarAreaKey(district: string, city: string, province: string) {
  return `${normalizeKeyPart(district)}|${normalizeKeyPart(city)}|${normalizeKeyPart(province)}`;
}

type AreaRow = {
  area_id: string;
  postal_code: string;
  payload: string | null;
};

type District = { district: string; city: string; province: string };

/**
 * How long a stored area answers before it is resolved again. The KV entry it
 * replaces lasted one day; area ids rarely change, so a month cuts the
 * Mengantar searches ~30x while bounding how long a retired id can live.
 */
export const MENGANTAR_AREA_MAX_AGE_DAYS = 30;

/**
 * The stored response body for a district, or null when it was never resolved
 * or was resolved more than `MENGANTAR_AREA_MAX_AGE_DAYS` ago.
 */
export async function readMengantarArea(
  database: D1Database,
  input: District,
  now: Date = new Date(),
): Promise<string | null> {
  // resolved_at is always an ISO-8601 UTC string with milliseconds (both the
  // seed's strftime and toISOString), so a string comparison orders it.
  const freshSince = new Date(now.getTime() - MENGANTAR_AREA_MAX_AGE_DAYS * 86_400_000).toISOString();
  const row = await database
    .prepare("SELECT area_id, postal_code, payload FROM mengantar_areas WHERE area_key = ? AND resolved_at >= ?")
    .bind(buildMengantarAreaKey(input.district, input.city, input.province), freshSince)
    .first<AreaRow>();
  if (!row?.area_id) return null;
  if (row.payload) return row.payload;
  const item = providerLocation({
    id: row.area_id,
    district: input.district.trim(),
    subdistrict: "",
    city: input.city.trim(),
    province: input.province.trim(),
    postalCode: row.postal_code,
  });
  const payload: ProviderLocationsPayload = {
    success: true,
    items: [item],
    locations: [item],
    alternatives: [],
  };
  return JSON.stringify(payload);
}

/**
 * Keeps a resolve body for its district. Only a body that resolved to an area
 * is kept: an empty answer stored for good would never be asked again.
 * A second store of the same district replaces the first.
 */
export async function storeMengantarArea(
  database: D1Database,
  input: District,
  body: string,
): Promise<boolean> {
  const first = (JSON.parse(body) as ProviderLocationsPayload).items?.[0];
  if (!first?.id) return false;
  await database
    .prepare(`
      INSERT INTO mengantar_areas
        (area_key, area_id, label, postal_code, payload, source, agreeing_orders, total_orders, resolved_at)
      VALUES (?, ?, ?, ?, ?, 'resolve', NULL, NULL, ?)
      ON CONFLICT(area_key) DO UPDATE SET
        area_id = excluded.area_id,
        label = excluded.label,
        postal_code = excluded.postal_code,
        payload = excluded.payload,
        source = excluded.source,
        agreeing_orders = NULL,
        total_orders = NULL,
        resolved_at = excluded.resolved_at
    `)
    .bind(
      buildMengantarAreaKey(input.district, input.city, input.province),
      first.id,
      first.label,
      first.postal_code || "",
      body,
      new Date().toISOString(),
    )
    .run();
  return true;
}

/**
 * Forgets every district stored with this area id, so the next resolve asks
 * Mengantar again. For a rate or dispatch that answers "area not found"
 * (REQ-244); the quote and dispatch only know the id, not the district.
 * No caller yet: wiring it into `shipping-quote.ts` and `mengantar-dispatch.ts`
 * is A-415, a protected-surface proposal awaiting approval.
 */
export async function dropMengantarArea(database: D1Database, areaId: string): Promise<number> {
  const id = areaId.trim();
  if (!id) return 0;
  const result = await database
    .prepare("DELETE FROM mengantar_areas WHERE area_id = ?")
    .bind(id)
    .run();
  return Number(result.meta?.changes ?? 0);
}

// Forgets a district whose fresh resolve was not exact, so a stale row — a
// seeded fallback id, or an exact answer Mengantar no longer gives — is not
// left behind once its bound has run out.
async function forgetMengantarArea(database: D1Database, input: District, now: Date = new Date()) {
  // Only an expired row: a fresh one can reach here when its read failed or a
  // concurrent request stored it, and it is still the better answer.
  const freshSince = new Date(now.getTime() - MENGANTAR_AREA_MAX_AGE_DAYS * 86_400_000).toISOString();
  await database
    .prepare("DELETE FROM mengantar_areas WHERE area_key = ? AND resolved_at < ?")
    .bind(buildMengantarAreaKey(input.district, input.city, input.province), freshSince)
    .run();
}

/**
 * The `level=resolve` answer: the stored one when there is one, otherwise a
 * live provider resolve, kept for next time. `provider` is asked for only on
 * a miss and answers null when Mengantar is not configured; the result is
 * then null too, and the caller falls back to the bundled catalogue. A stored
 * row still answers when Mengantar is not configured. A D1
 * failure on either side is logged and never fails the buyer's form — it
 * just costs a provider call.
 */
export async function resolveMengantarArea(
  database: D1Database,
  provider: () => Promise<((keyword: string) => Promise<ProviderAddressRow[]>) | null>,
  input: District,
): Promise<{ body: string; stored: boolean } | null> {
  try {
    const stored = await readMengantarArea(database, input);
    if (stored) return { body: stored, stored: true };
  } catch (error) {
    console.error("mengantar-area-read-failed", error);
  }
  const searchAddress = await provider();
  if (!searchAddress) return null;
  const payload = await fetchProviderLocations(searchAddress, {
    search: input.district,
    city: input.city,
    province: input.province,
    resolve: true,
  });
  const body = JSON.stringify(payload);
  // lazy: a district Mengantar does not resolve exactly (no items, or only a
  // fallback such as Jakabaring → Seberang Ulu I, 8 Ulu) is not stored, so
  // each buyer who picks one asks again (up to ~15 searches; KV held it for a
  // day). Upgrade path: store fallbacks with a short age if such districts
  // show up in the provider-call counts.
  const exact = resolveProviderDestinations(payload.items, input.district.trim(), input.city.trim()).length > 0;
  // Store an exact answer; otherwise delete the key's row if it has expired.
  try {
    if (exact) await storeMengantarArea(database, input, body);
    else await forgetMengantarArea(database, input);
  } catch (error) {
    console.error("mengantar-area-write-failed", error);
  }
  return { body, stored: false };
}
