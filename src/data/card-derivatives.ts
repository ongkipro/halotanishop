/**
 * Static images that have a card-sized twin beside them (`<name>-sm.webp`).
 *
 * `cardImageSrc` (lib/image-derivative.ts) swaps an upload for its `-sm`
 * derivative because `/assets/[...key].ts` falls back to the original when the
 * derivative is missing. A static file under `public/` has no such fallback:
 * a missing `-sm` file answers 404 through the Worker, so a path is listed here
 * only after its twin exists.
 *
 * Generated: `npm run card-images` writes the twins and rewrites this list. A
 * store whose products use uploads only keeps it empty and changes nothing.
 */
export const CARD_DERIVATIVES: ReadonlySet<string> = new Set<string>([]);
