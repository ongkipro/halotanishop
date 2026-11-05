/**
 * Automatic Google & Meta Product Taxonomy Engine
 *
 * Maps a product's category, title and description to:
 * 1. a Google Product Category id + path (`google_product_category`);
 * 2. a Meta product category path (`fb_product_category`) — Meta's own
 *    taxonomy, which is not Google's;
 * 3. a structured product type (`product_type`, merchant-facing, free text).
 *
 * Every id and path below was copied from the official files, not recalled:
 * - Google: https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt
 *   (version 2021-09-21);
 * - Meta: https://www.facebook.com/products/categories/en_US.txt (2026-10-08).
 * The previous table carried ids that named other products entirely — skin care
 * was Placemats (2547), herbal supplements Bread Pans (642), gardening a Laundry
 * Combo Unit (2849) — and 2863/1630 do not exist. Check a new rule against the
 * same files; `ad-taxonomy.test.ts` pins every pair.
 *
 * A side with no faithful match is left out: both fields are optional, and
 * saying nothing is safer than a wrong category (see DEFAULT_TAXONOMY).
 */

export interface AdTaxonomy {
  /**
   * Absent when no rule was confident enough. A feed omits the category rather
   * than asserting one — see DEFAULT_TAXONOMY.
   */
  googleCategoryId?: number;
  googleCategoryName?: string;
  metaCategoryName?: string;
  productType: string;
}

export interface TaxonomyRule {
  google?: { id: number; path: string };
  metaPath?: string;
  productType: string;
  keywords: string[];
  /**
   * Considered only when no specific rule reaches MIN_SCORE. "Waist bag" also
   * contains "bag", so without this the parent tied every specific bag rule
   * and the product went out with no category at all.
   */
  fallback?: boolean;
}

export const TAXONOMY_RULES: readonly TaxonomyRule[] = [
  // Bags and leather goods. Specific rules first in spirit; the scorer, not the
  // order, decides — a specific rule wins by matching more of the name.
  {
    google: { id: 6551, path: "Apparel & Accessories > Handbags, Wallets & Cases" },
    metaPath: "travel & luggage > handbags & wallets",
    productType: "Tas & Dompet",
    keywords: ["tas", "bag"],
    fallback: true,
  },
  {
    google: { id: 3032, path: "Apparel & Accessories > Handbags, Wallets & Cases > Handbags" },
    metaPath: "travel & luggage > handbags & wallets",
    productType: "Tas & Dompet > Handbag & Clutch",
    keywords: ["handbag", "hand bag", "tas tangan", "clutch", "pouch"],
  },
  {
    google: { id: 3032, path: "Apparel & Accessories > Handbags, Wallets & Cases > Handbags" },
    metaPath: "travel & luggage > handbags & wallets > totes",
    productType: "Tas & Dompet > Totebag",
    keywords: ["tote", "tote bag", "totebag"],
  },
  {
    google: { id: 106, path: "Luggage & Bags > Messenger Bags" },
    metaPath: "travel & luggage > handbags & wallets > crossbody bags",
    productType: "Tas & Dompet > Sling Bag",
    keywords: ["sling", "sling bag", "slingbag", "selempang", "tas selempang", "messenger", "crossbody", "shoulder bag"],
  },
  {
    google: { id: 104, path: "Luggage & Bags > Fanny Packs" },
    metaPath: "travel & luggage > handbags & wallets > belt bags & waist packs",
    productType: "Tas & Dompet > Waist Bag",
    keywords: ["waist bag", "waistbag", "fanny pack", "tas pinggang", "belt bag", "chest bag"],
  },
  {
    google: { id: 100, path: "Luggage & Bags > Backpacks" },
    metaPath: "travel & luggage > backpacks",
    productType: "Tas & Dompet > Backpack",
    keywords: ["backpack", "ransel", "tas ransel", "daypack"],
  },
  {
    // Google has no laptop-bag category; Meta does.
    metaPath: "travel & luggage > briefcases & laptop bags",
    productType: "Tas & Dompet > Tas Laptop",
    keywords: ["laptop", "laptop sleeve", "laptop bag", "tas laptop", "briefcase", "macbook"],
  },
  {
    google: { id: 2668, path: "Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips" },
    metaPath: "travel & luggage > handbags & wallets > wallets",
    productType: "Tas & Dompet > Dompet",
    keywords: ["dompet", "wallet", "long wallet", "bifold", "bilfold", "money clip", "card holder", "cardholder", "card case"],
  },
  {
    // Meta has no badge-holder category.
    google: { id: 6170, path: "Apparel & Accessories > Handbags, Wallets & Cases > Badge & Pass Holders" },
    productType: "Tas & Dompet > ID Card Holder",
    keywords: ["id card", "id card holder", "name tag", "lanyard", "badge holder"],
  },
  {
    // Meta's belts are split by gender; the ungendered parent is the honest fit.
    google: { id: 169, path: "Apparel & Accessories > Clothing Accessories > Belts" },
    metaPath: "clothing & accessories > clothing accessories",
    productType: "Fashion & Pakaian > Ikat Pinggang",
    keywords: ["belt", "ikat pinggang", "sabuk", "gesper"],
  },
  {
    google: { id: 628, path: "Home & Garden > Household Supplies > Shoe Care & Tools" },
    metaPath: "home > cleaning supplies > shoe care",
    productType: "Perawatan > Perawatan Kulit Asli",
    keywords: ["leather balm", "leather care", "leather conditioner", "balm kulit", "semir", "shoe polish"],
  },
  {
    google: { id: 113, path: "Home & Garden > Lawn & Garden > Gardening > Fertilizers" },
    metaPath: "patio & garden > plant care, soil & accessories > fertilizers",
    productType: "Pertanian > Pupuk & Nutrisi",
    keywords: [
      "pupuk", "fertilizer", "sawit", "padi", "cabai", "jagung", "tanaman", "ganoderma",
      "pertanian", "hama", "buah", "daun", "akar", "nutrisi tanaman", "organik", "nPK"
    ],
  },
  {
    google: { id: 2962, path: "Home & Garden > Lawn & Garden > Gardening" },
    metaPath: "patio & garden > gardening supplies",
    productType: "Pertanian > Perkebunan & Benih",
    keywords: ["benih", "biji", "bibit", "kebun", "taman", "media tanam", "pot"],
  },
  {
    google: { id: 567, path: "Health & Beauty > Personal Care > Cosmetics > Skin Care" },
    metaPath: "health & beauty > beauty > skin care",
    productType: "Kecantikan & Perawatan > Skincare",
    // Not "kulit": it means leather as often as skin, and filed every leather
    // card holder in a leather-goods store under Skin Care.
    // Not "kojien" either: taniniaga sells a plant-nutrient called Kojien, and
    // its title alone filed it under Skin Care in both feeds (2026-11-03).
    keywords: [
      "skincare", "skin care", "serum", "lotion", "cream", "krim", "pemutih", "kojic",
      "wajah", "glowing", "acne", "jerawat", "toner", "sunscreen"
    ],
  },
  {
    google: { id: 474, path: "Health & Beauty > Personal Care > Cosmetics > Bath & Body" },
    metaPath: "health & beauty > beauty > bath & body > body washes & soaps",
    productType: "Kecantikan & Perawatan > Sabun & Mandi",
    keywords: ["sabun", "soap", "body wash", "mandi", "cleanser"],
  },
  {
    // Meta has no supplements category.
    google: { id: 525, path: "Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements" },
    productType: "Kesehatan > Suplemen Herbal",
    keywords: [
      "herbal", "madu", "stamina", "vitalitas", "jamu", "pinang", "teh herbal",
      "suplemen", "kesehatan", "obat herbal", "kapsul"
    ],
  },
  {
    google: { id: 1604, path: "Apparel & Accessories > Clothing" },
    metaPath: "clothing & accessories > clothing",
    productType: "Fashion & Pakaian > Pakaian",
    keywords: ["baju", "kaos", "shirt", "celana", "jaket", "hoodie", "pakaian", "dress", "gamis", "fashion"],
  },
  {
    google: { id: 668, path: "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils" },
    metaPath: "home > home goods > kitchen & dining > kitchen tools & utensils",
    productType: "Perkakas & Rumah Tangga > Alat Dapur",
    keywords: ["pisau", "asahan", "alat dapur", "dapur", "pengasah", "potong", "perkakas", "rumah tangga"],
  },
  {
    google: { id: 222, path: "Electronics" },
    metaPath: "electronics",
    productType: "Elektronik & Gadget",
    keywords: ["elektronik", "gadget", "hp", "charger", "kabel", "headset", "lampu", "led"],
  },
];

/**
 * No category at all, deliberately.
 *
 * This used to default to the handbag parent (`6551`), justified in the note below as "at
 * least a category this catalog sells" — true while the product shipped a
 * bundled handbag catalogue. That catalogue is gone: an install starts empty and
 * sells whatever its merchant sells. Keeping the default would have submitted
 * every unclassified product in every store to Merchant Center as a handbag,
 * which is precisely the misrepresentation the note warns about.
 *
 * `google_product_category` and `fb_product_category` are optional on both
 * platforms, and Google auto-classifies what a feed omits. Saying nothing is
 * strictly safer than saying something wrong.
 */
const DEFAULT_TAXONOMY: AdTaxonomy = {
  productType: "Umum",
};

/**
 * Scoring — deliberately conservative.
 *
 * A wrong category in a Merchant Center feed is grounds for a misrepresentation
 * suspension, and there is no catalogue to make a default safe. So a rule has to
 * earn the win, and an unconfident match emits no category at all:
 *
 * 1. Keywords match whole words, never substrings. "sebuah" used to count as a
 *    fertilizer hit ("buah"), "kertas" and "bagus" as handbag hits ("tas", "bag").
 * 2. Category and title decide. A hit there is worth NAME_HIT_WEIGHT.
 * 3. The description only breaks ties: its distinct hits are capped below the
 *    weight of a single name hit, so a long description mentioning foreign words
 *    can never outvote the words that actually name the product.
 * 4. A rule must reach MIN_SCORE — one name hit — and be the sole top scorer.
 *    Ties and under-confidence both fall through to the default.
 */
const NAME_HIT_WEIGHT = 3;
const DESCRIPTION_HIT_CAP = 2;
const MIN_SCORE = NAME_HIT_WEIGHT;

const keywordPatterns = new Map<string, RegExp>();

function matchesKeyword(text: string, keyword: string): boolean {
  if (!text) return false;
  let pattern = keywordPatterns.get(keyword);
  if (!pattern) {
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`);
    keywordPatterns.set(keyword, pattern);
  }
  return pattern.test(text);
}

function scoreRule(rule: TaxonomyRule, name: string, description: string): number {
  let nameHits = 0;
  let descriptionHits = 0;
  for (const keyword of rule.keywords) {
    // A keyword counts once, in the strongest field it appears in.
    if (matchesKeyword(name, keyword)) nameHits += 1;
    else if (matchesKeyword(description, keyword)) descriptionHits += 1;
  }
  return nameHits * NAME_HIT_WEIGHT + Math.min(descriptionHits, DESCRIPTION_HIT_CAP);
}

/**
 * Derives Google & Meta Product Taxonomy automatically from product metadata.
 */
export function getAdTaxonomy(
  category?: string | null,
  title?: string | null,
  description?: string | null
): AdTaxonomy {
  const name = [category, title].filter(Boolean).join(" ").toLowerCase().trim();
  const body = (description || "").toLowerCase().trim();

  if (!name && !body) {
    return DEFAULT_TAXONOMY;
  }

  let bestRule: TaxonomyRule | null = null;
  let tied = false;
  for (const pool of [TAXONOMY_RULES.filter((r) => !r.fallback), TAXONOMY_RULES.filter((r) => r.fallback)]) {
    let bestScore = 0;
    for (const rule of pool) {
      const score = scoreRule(rule, name, body);
      if (score < MIN_SCORE) continue;
      if (score > bestScore) {
        bestScore = score;
        bestRule = rule;
        tied = false;
      } else if (score === bestScore) {
        tied = true;
      }
    }
    // A confident specific match, or a tie among specific rules, ends the
    // search: a tie must not be resolved by the vaguer parent.
    if (bestRule) break;
  }

  if (bestRule && !tied) {
    return {
      ...(bestRule.google
        ? { googleCategoryId: bestRule.google.id, googleCategoryName: bestRule.google.path }
        : {}),
      ...(bestRule.metaPath ? { metaCategoryName: bestRule.metaPath } : {}),
      productType: bestRule.productType,
    };
  }

  // Under-confident or ambiguous: fall back cleanly, keeping the merchant's own
  // category label as the product type when there is one.
  const cleanCategory = (category || "").trim();
  return {
    ...DEFAULT_TAXONOMY,
    productType: cleanCategory ? `Umum > ${cleanCategory}` : DEFAULT_TAXONOMY.productType,
  };
}
