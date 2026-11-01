import { parseTrafficSource } from "./traffic-source.ts";

/**
 * The ad channel an order came through, read-only (PRD A37, REQ-203).
 *
 * `traffic-source.ts` is a protected surface, so it is called here, never
 * edited: Meta and Google are exactly what `parseTrafficSource` (and so the
 * order list's badge) says. This module only splits what that function lumps
 * together as "custom" or "organic".
 *
 * **Stored shape.** `orders.ad_click_ids` is NULL, or the JSON object
 * `serializeClickIds` writes: a subset of `CLICK_ID_KEYS` (`gclid`, `gbraid`,
 * `wbraid`, `_fbp`, `_fbc`, `fbclid`, `utm_source`, `utm_medium`,
 * `utm_campaign`, `utm_content`, `utm_term`), each a string matching
 * `[A-Za-z0-9._-]{1,256}`, e.g.
 * `{"fbclid":"IwAR1","_fbc":"fb.1.1730000000000.IwAR1","utm_source":"facebook"}`.
 * It is written only when at least one key is present. Rows from before TikTok
 * was dropped from `CLICK_ID_KEYS` may also hold `ttclid`, which is still read
 * as TikTok so those orders do not turn organic.
 *
 * Note what `parseTrafficSource` decides and this inherits: a `_fbp` cookie
 * alone reads as Meta, and a `utm_source` containing `ig` or `fb` does too.
 *
 * `adChannelSql` is the same decision as a SQL `CASE` for aggregation;
 * `ad-channel.test.ts` runs both over the same stored values.
 */
export const AD_CHANNELS = ["meta", "google", "tiktok", "other_paid", "organic", "direct"] as const;
export type AdChannel = (typeof AD_CHANNELS)[number];

export const AD_CHANNEL_LABELS: Record<AdChannel, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  other_paid: "Iklan lain",
  organic: "Organik",
  direct: "Langsung",
};

/** `utm_medium` values that mean a bought placement, compared lower-cased. */
const PAID_MEDIUMS = ["cpc", "ppc", "cpm", "cpv", "paid", "paid_social", "paidsocial", "paid-social", "display", "ads", "ad", "banner"] as const;

function legacyTtclid(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.ttclid === "string" && parsed.ttclid);
  } catch {
    return false;
  }
}

export function adChannelFromClickIds(raw: string | null | undefined): AdChannel {
  const source = parseTrafficSource(raw);
  if (source.type === "meta") return "meta";
  if (source.type === "google") return "google";
  const utmSource = source.details.utm_source || "";
  if (legacyTtclid(raw) || utmSource.includes("tiktok")) return "tiktok";
  if (source.type === "custom") {
    const medium = (source.details.utm_medium || "").toLowerCase();
    return (PAID_MEDIUMS as readonly string[]).includes(medium) ? "other_paid" : "organic";
  }
  // `parseTrafficSource` calls both of these organic; a tag that says
  // "organic" is one, and no tag at all is a direct visit.
  return utmSource && utmSource !== "direct" ? "organic" : "direct";
}

/**
 * The same decision in SQL, over a column holding the stored shape. It mirrors
 * `parseTrafficSource` step by step: a key counts only as a non-empty JSON
 * string, `utm_source` is trimmed and lower-cased, Meta is checked before
 * Google. SQLite's `lower()` is ASCII-only, which the stored pattern already is.
 */
export function adChannelSql(column = "ad_click_ids"): string {
  // CASE, not AND: json_type() raises on malformed text, and only CASE is
  // guaranteed to stop before evaluating it.
  const obj = `(CASE WHEN json_valid(${column}) THEN json_type(${column}) END = 'object')`;
  const str = (key: string) => `(CASE WHEN json_type(${column}, '$.${key}') = 'text' THEN json_extract(${column}, '$.${key}') END)`;
  const has = (key: string) => `COALESCE(${str(key)}, '') <> ''`;
  const utm = `lower(trim(COALESCE(${str("utm_source")}, ''), ' ' || char(9, 10, 11, 12, 13)))`;
  const medium = `lower(trim(COALESCE(${str("utm_medium")}, ''), ' ' || char(9, 10, 11, 12, 13)))`;
  const utmHas = (needle: string) => `instr(${utm}, '${needle}') > 0`;
  const paid = PAID_MEDIUMS.map((value) => `'${value}'`).join(", ");
  return `(CASE
    WHEN NOT COALESCE(${obj}, 0) THEN 'direct'
    WHEN ${has("fbclid")} OR ${has("_fbc")} OR ${has("_fbp")}
      OR ${utmHas("meta")} OR ${utmHas("facebook")} OR ${utmHas("fb")} OR ${utmHas("instagram")} OR ${utmHas("ig")} THEN 'meta'
    WHEN ${has("gclid")} OR ${has("gbraid")} OR ${has("wbraid")}
      OR ${utmHas("google")} OR ${utmHas("gads")} OR ${utmHas("cpc")} THEN 'google'
    WHEN ${has("ttclid")} OR ${utmHas("tiktok")} THEN 'tiktok'
    WHEN ${utm} NOT IN ('', 'organic', 'direct') THEN
      CASE WHEN ${medium} IN (${paid}) THEN 'other_paid' ELSE 'organic' END
    WHEN ${utm} = 'organic' THEN 'organic'
    ELSE 'direct'
  END)`;
}
