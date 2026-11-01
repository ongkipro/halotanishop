import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '../../../../lib/api.ts';
import { getRuntimeEnv } from '../../../../lib/env.ts';
import { readHealthSnapshot, statusIconState } from '../../../../lib/health-snapshot.ts';

export const prerender = false;

/**
 * The admin status icon's one read (PRD A39): the stored snapshot, with the
 * staleness rule applied now, reduced to a tone, a count and words. One row,
 * no collection. Owner and admin only, through `/api/admin/health` in
 * `ADMIN_API_ROUTES`.
 *
 * The browser keeps the answer in sessionStorage for five minutes. The
 * middleware sends `no-store` on every admin response, so no HTTP cache
 * header is set here.
 */
export const GET: APIRoute = async ({ locals }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;
  if (!database?.prepare) return jsonError('Database belum tersedia.', 503);
  const snapshot = await readHealthSnapshot(database);
  return jsonOk({ icon: statusIconState(snapshot, Date.now()) });
};
