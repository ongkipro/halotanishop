/**
 * Home page <title> and meta description from the store's own identity.
 *
 * A tagline that already opens with the store name used to render
 * "Zvara Shop — Zvara Shop, toko online ..." (131 characters, cut off in
 * results), and a store with no description got "Belanja online di X." (under
 * 40 characters). Both are composed here so a store never repeats its name
 * or ships a snippet too short to rank.
 */

const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 160;

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const space = head.lastIndexOf(" ");
  return (space > max * 0.6 ? head.slice(0, space) : head.slice(0, max)).replace(/[\s,.;:–—-]+$/, "");
}

/** `<Name> — <tail>`, never repeating the name, at most 60 characters. */
export function homeTitle(name: string, tail: string): string {
  const cleanName = name.trim();
  let rest = tail.trim();
  if (rest.toLowerCase().startsWith(cleanName.toLowerCase())) {
    rest = rest.slice(cleanName.length).replace(/^[\s,.:;–—-]+/, "");
  }
  if (!rest) return cleanName;
  const room = TITLE_MAX - cleanName.length - 3;
  if (room < 12) return cleanName;
  return `${cleanName} — ${cutAtWord(rest, room)}`;
}

/** The store description, extended with its own categories when too short. */
export function homeDescription(description: string, categories: readonly string[]): string {
  const base = description.trim();
  if (base.length >= DESCRIPTION_MIN) return cutAtWord(base, DESCRIPTION_MAX);
  const seen = new Set<string>();
  const names = categories
    .map((category) => category.trim())
    .filter((category) => category && !seen.has(category.toLowerCase()) && seen.add(category.toLowerCase()));
  if (names.length === 0) return base;
  const joined = `${base} Kategori: ${names.slice(0, 5).join(", ")}.`;
  return cutAtWord(joined, DESCRIPTION_MAX);
}
