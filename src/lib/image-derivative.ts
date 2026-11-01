import { CARD_DERIVATIVES } from '../data/card-derivatives.ts';

/**
 * The catalogue card renders at 182 CSS px, which is 478 device pixels on the
 * phone Lighthouse emulates, while the product detail view renders at 480 CSS
 * px and genuinely wants the full upload. One file cannot serve both without
 * wasting most of its bytes on the card, so a card-sized derivative lives
 * beside the original as `<name>-sm.<ext>`.
 *
 * `/assets/[...key].ts` falls back to the original when the derivative is
 * absent, so calling this on an image that has none is safe — it costs the old
 * number of bytes rather than breaking the tile.
 */
export function cardImageSrc(
  url: string,
  derivatives: ReadonlySet<string> = CARD_DERIVATIVES,
): string {
  const trimmed = url?.trim() ?? '';
  // A static image has no server-side fallback, so only a listed one is swapped.
  if (derivatives.has(trimmed)) return trimmed.replace(/(\.[a-z0-9]+)$/i, '-sm$1');
  if (!trimmed.startsWith('/assets/uploads/')) return trimmed;
  if (/-sm\.[a-z0-9]+$/i.test(trimmed)) return trimmed;
  return trimmed.replace(/(\.[a-z0-9]+)$/i, '-sm$1');
}
