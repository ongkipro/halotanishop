/**
 * Search over Google's product taxonomy (public/data/google-product-taxonomy.json,
 * built by scripts/generate-google-taxonomy.mjs).
 *
 * A product's chosen id is what the Google and Meta feeds send as
 * `google_product_category` — exact, instead of the keyword engine's guess
 * (`ad-taxonomy.ts`, still the fallback for a product with no id).
 *
 * Google publishes the list in English only, while operators search in
 * Indonesian, so a query is widened with English equivalents of common
 * Indonesian shop words before matching.
 */
import { getAdTaxonomy } from "./ad-taxonomy.ts";

export type TaxonomyRow = readonly [id: number, path: string];

// lazy: a hand list of common shop words. Upgrade path: a full id-ID label set
// if Google ever publishes one (taxonomy-with-ids.id-ID.txt answers 404).
const ALIASES: Record<string, string[]> = {
  sabun: ["soap"],
  sampo: ["shampoo"],
  shampo: ["shampoo"],
  kosmetik: ["cosmetics", "makeup"],
  kecantikan: ["beauty", "cosmetics"],
  wajah: ["facial", "face"],
  kulit: ["skin"],
  serum: ["serum", "skin care"],
  krim: ["cream", "lotion"],
  rambut: ["hair"],
  apel: ["apple"],
  parfum: ["perfume", "fragrance"],
  minyak: ["oil"],
  vitamin: ["vitamins", "supplements"],
  suplemen: ["supplements"],
  herbal: ["herbal", "supplements"],
  madu: ["honey"],
  cuka: ["vinegar"],
  minuman: ["beverages", "drinks"],
  makanan: ["food"],
  kopi: ["coffee"],
  teh: ["tea"],
  pembersih: ["household cleaning products", "cleaner", "cleaning"],
  dapur: ["kitchen"],
  panci: ["cookware", "pots"],
  rumah: ["household"],
  lampu: ["lighting", "lamps", "light bulbs"],
  senter: ["flashlights"],
  tas: ["bags", "handbags"],
  dompet: ["wallets"],
  sepatu: ["shoes"],
  sandal: ["sandals"],
  baju: ["clothing", "shirts"],
  kaos: ["shirts", "t-shirts"],
  celana: ["pants"],
  jaket: ["jackets"],
  jam: ["watches"],
  kacamata: ["eyewear", "sunglasses"],
  mainan: ["toys"],
  bayi: ["baby"],
  hewan: ["pet", "animals"],
  kucing: ["cat"],
  anjing: ["dog"],
  tanaman: ["plants"],
  bibit: ["seeds", "plants"],
  pupuk: ["fertilizers"],
  kebun: ["garden"],
  motor: ["motorcycle"],
  mobil: ["vehicle", "car"],
  hp: ["mobile phone"],
  ponsel: ["mobile phone"],
  charger: ["chargers"],
  kabel: ["cables"],
  lem: ["adhesives", "glue"],
  alat: ["tools"],
  cukur: ["shaving", "razors"],
  gigi: ["oral care", "teeth"],
  obat: ["medicine", "health care"],
  kesehatan: ["health"],
  olahraga: ["sporting goods", "fitness"],
  buku: ["books"],
  baterai: ["batteries"],
  kapsul: ["vitamins & supplements"],
  jamu: ["vitamins & supplements"],
  deodoran: ["deodorant"],
  nyamuk: ["insect repellent"],
  sikat: ["brushes"],
};

// Two-word shop terms whose words mislead apart ("minyak" alone is fuel oil).
// A phrase found in the query is matched first, at the highest weight.
const PHRASES: Record<string, string[]> = {
  "minyak kemiri": ["hair care"],
  "minyak rambut": ["hair care"],
  "minyak urut": ["massage oil"],
  "minyak pijat": ["massage oil"],
  "minyak telon": ["body oil"],
  "pasta gigi": ["toothpaste"],
  "sikat gigi": ["toothbrushes"],
  "celana dalam": ["underwear"],
  "power bank": ["batteries"],
};

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Rows ranked by the query words they match. A word matches through itself or
 * an alias, at a word start only, so "lamps" never matches "Clamps".
 *
 * - Indonesian puts the head noun first ("cuka apel" is a vinegar), so an
 *   earlier word weighs more than a later one.
 * - A leaf that *is* the word ("Vinegar", "Lamps") beats a leaf that contains
 *   it, which beats a match higher up the path.
 * - Ties go to the shorter path: the general category before a niche one.
 *
 * One matching word is enough, so a query naming something Google has no
 * category for still offers the nearest ones.
 */
export function searchTaxonomy(rows: readonly TaxonomyRow[], query: string, limit = 30): TaxonomyRow[] {
  const id = query.trim().match(/^\d+$/)?.[0];
  if (id) return rows.filter((row) => String(row[0]) === id);
  const lower = query.toLowerCase();
  const phrases = Object.keys(PHRASES).filter((phrase) => lower.includes(phrase));
  const queryWords = words(phrases.reduce((rest, phrase) => rest.replace(phrase, " "), lower));
  if (!queryWords.length && !phrases.length) return [];
  const groups = [
    ...phrases.map((phrase) => PHRASES[phrase]),
    ...queryWords.map((word) => [word, ...(ALIASES[word] ?? [])]),
  ];
  const terms = groups.map((options, index) => {
    return {
      weight: (groups.length - index) * (index < phrases.length ? 2 : 1),
      exact: new Set(options.flatMap((option) => [option, `${option}s`, `${option}es`])),
      start: options.map((option) => new RegExp(`(^|[^\\p{L}])${escapeRegExp(option)}`, "u")),
    };
  });
  const scored: { row: TaxonomyRow; score: number }[] = [];
  for (const row of rows) {
    const path = row[1].toLowerCase();
    const leaf = path.slice(path.lastIndexOf(">") + 1).trim();
    let score = 0;
    for (const term of terms) {
      if (term.exact.has(leaf)) score += 3 * term.weight;
      else if (term.start.some((pattern) => pattern.test(leaf))) score += 2 * term.weight;
      else if (term.start.some((pattern) => pattern.test(path))) score += term.weight;
    }
    if (score > 0) scored.push({ row, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.row[1].length - b.row[1].length)
    .slice(0, limit)
    .map((entry) => entry.row);
}

/** The last segment of a taxonomy path: "Health & Beauty > … > Soap" → "Soap". */
export const taxonomyLeaf = (path: string) => path.split(" > ").pop()?.trim() || path;

/**
 * Categories to offer for a product, best first, from its own name and label:
 * the keyword engine's confident rule (the same guess the feeds fall back to),
 * then a taxonomy search on the product name, then on the store label. The
 * form auto-selects the first when the product has none and shows the rest as
 * one-click alternatives. Only ids present in Google's list are offered.
 */
export function suggestGoogleCategories(
  rows: readonly TaxonomyRow[],
  product: { title?: string; category?: string; description?: string },
  limit = 4,
): TaxonomyRow[] {
  const byId = new Map(rows.map((row) => [row[0], row]));
  const label = product.category?.trim() && product.category.trim() !== "Umum" ? product.category.trim() : "";
  const picks: TaxonomyRow[] = [];
  const add = (row: TaxonomyRow | undefined) => {
    if (row && !picks.some((pick) => pick[0] === row[0])) picks.push(row);
  };
  const guess = getAdTaxonomy(label, product.title, product.description).googleCategoryId;
  if (guess) add(byId.get(guess));
  if (product.title?.trim()) searchTaxonomy(rows, product.title, limit).forEach(add);
  if (label) searchTaxonomy(rows, label, limit).forEach(add);
  return picks.slice(0, limit);
}
