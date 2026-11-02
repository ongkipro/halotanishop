import type { APIRoute } from 'astro';
import { getRuntimeEnv } from '../../lib/env';

export const prerender = false;

const SAFE_KEY =
  /^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+(?:-sm)?\.(?:jpg|png|webp|gif|avif)$/i;

/** A card-sized derivative sits beside its original as `<name>-sm.<ext>`. */
const DERIVATIVE_SUFFIX = /-sm(\.[a-z0-9]+)$/i;
const FEED_JPEG = /\.jpg$/i;

export const GET: APIRoute = async ({ params, locals }) => {
  const key = String(params.key || '');
  if (!SAFE_KEY.test(key)) return new Response('Not found', { status: 404 });

  const bucket = getRuntimeEnv(locals)?.ASSET_BUCKET as R2Bucket | undefined;
  if (!bucket) return new Response('Asset storage unavailable', { status: 503 });

  let object = await bucket.get(key);
  // True when the body is a stand-in for the object that was asked for.
  let standIn = false;
  // A derivative that was never generated - an image uploaded before the
  // storefront started asking for one - falls back to the full image. The card
  // then costs more than it should, which is the old behaviour, rather than
  // rendering a broken tile.
  if (!object && DERIVATIVE_SUFFIX.test(key)) {
    object = await bucket.get(key.replace(DERIVATIVE_SUFFIX, '$1'));
    standIn = Boolean(object);
  }
  // Catalog feeds ask for a `.jpg` sibling of each WebP upload (Meta takes
  // JPEG or PNG only - see feedImagePath). Until one is stored, the WebP is
  // served, which is what the feed linked before.
  if (!object && FEED_JPEG.test(key)) {
    object = await bucket.get(key.replace(FEED_JPEG, '.webp'));
    standIn = Boolean(object);
  }
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  if (object.httpMetadata?.contentType) headers.set('Content-Type', object.httpMetadata.contentType);
  if (object.httpMetadata?.contentLanguage) headers.set('Content-Language', object.httpMetadata.contentLanguage);
  if (object.httpMetadata?.contentDisposition) headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
  if (object.httpMetadata?.contentEncoding) headers.set('Content-Encoding', object.httpMetadata.contentEncoding);
  if (object.httpMetadata?.cacheControl) headers.set('Cache-Control', object.httpMetadata.cacheControl);
  if (object.httpMetadata?.cacheExpiry) headers.set('Expires', object.httpMetadata.cacheExpiry.toUTCString());
  headers.set('ETag', object.httpEtag);
  // A stand-in must not be pinned for a year: once the real derivative is
  // stored, the edge would keep serving the full image under the card's URL
  // (agritani's home downloaded two 56-76 KB heroes twice for months).
  headers.set('Cache-Control', standIn ? 'public, max-age=600' : 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  return new Response(object.body as unknown as BodyInit, { headers });
};
