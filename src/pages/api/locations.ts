import type { APIRoute } from 'astro';
import { getRuntimeEnv } from '../../lib/env';
import { searchDistrictCatalog } from '../../lib/district-catalog';
import { createDistrictDiscoveryLocation, fetchProviderLocations } from '../../lib/location-search';
import { resolveMengantarArea } from '../../lib/mengantar-areas';
import { MengantarClient } from '../../lib/mengantar-client';
import { getProviderConfig } from '../../lib/provider-config';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '../../lib/rate-limit';

export const prerender = false;

export const GET: APIRoute = async ({ request, url, locals }) => {
  try {
    const runtimeEnv = getRuntimeEnv(locals);
    const search = url.searchParams.get('search') || '';
    const level = url.searchParams.get('level');
    if (!search || search.trim().length < 2) {
      return new Response(
        JSON.stringify({ success: true, locations: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Typing suggestions never need the provider: the local catalogue is
    // instant, needs no network, and stays usable if Mengantar is slow or
    // down. `level=resolve` (fired on selection, not on keystroke) is the
    // only call that has to reach the provider for a real destination id.
    //
    // No rate-limit counter on this branch, on purpose. It is a pure in-memory
    // scan with nothing to protect, and the form fires it on every keystroke:
    // counting each one was a store write per character, which is how a
    // shared daily KV allowance was spent on typing (ADR-021).
    if (level === 'district') {
      const items = searchDistrictCatalog(search).map(createDistrictDiscoveryLocation);
      return new Response(
        JSON.stringify({ success: true, items, locations: items }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const rateLimit = await checkRateLimit(
      runtimeEnv?.OMS_DB as D1Database | undefined,
      `public-location:${getClientIp(request.headers)}`,
      120,
      60_000,
    );
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ success: false, error: 'Terlalu banyak pencarian lokasi. Coba lagi sebentar.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateLimit.remaining, rateLimit.resetAt) } },
      );
    }

    const province = (url.searchParams.get('province') || '').trim();
    const city = (url.searchParams.get('city') || '').trim();

    const catalogueOnly = () => {
      const items = searchDistrictCatalog(search).map(createDistrictDiscoveryLocation);
      return new Response(
        JSON.stringify({ success: true, items, locations: items }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const database = runtimeEnv?.OMS_DB;
    if (!database || typeof database !== "object") return catalogueOnly();
    const db = database as D1Database;
    const provider = async () => {
      const config = (await getProviderConfig(db, locals)).mengantar;
      if (!config.apiKey) return null;
      const client = new MengantarClient(config.apiKey, config.baseUrl);
      return (keyword: string) => client.searchAddress(keyword);
    };
    // A district resolved once (or seeded from this store's orders) is
    // answered from D1 with no Mengantar call and no KV write (PRD A43).
    if (level === 'resolve' && city) {
      const resolved = await resolveMengantarArea(db, provider, { district: search, city, province });
      if (!resolved) return catalogueOnly();
      // Same headers each branch had before: a stored answer was a KV hit.
      return resolved.stored
        ? new Response(resolved.body, { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response(resolved.body);
    }
    const searchAddress = await provider();
    if (!searchAddress) return catalogueOnly();
    // Free-text provider search (the admin pickers, and the buyer's kelurahan
    // fallback) is not cached: the 10-minute KV entry it had was a KV write
    // per typed prefix and was rarely asked for twice (A-414).
    const payload = await fetchProviderLocations(searchAddress, {
      search,
      city,
      province,
      resolve: level === 'resolve',
    });
    return new Response(JSON.stringify(payload));
  } catch (error) {
    // Labelled so Workers Logs can answer "why did kecamatan search 500" —
    // the previous silent catch hid a quota outage for a whole fleet.
    console.error('public-location-search-failed', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Gagal mencari lokasi' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
