/**
 * The admin UTM link builder (PRD A45, REQ-262). Pure: it composes a URL and
 * stores nothing. The fixed source/medium lists are PRD A45 Q3; every tag it
 * writes is already in the form Analitik › UTM groups by (`utmTagSql`:
 * trimmed, lower-case), so a campaign built here never splits into two rows.
 */

export const UTM_SOURCES = [
  { value: "facebook", label: "Facebook", medium: "paid_social" },
  { value: "instagram", label: "Instagram", medium: "paid_social" },
  { value: "google", label: "Google", medium: "cpc" },
  { value: "tiktok", label: "TikTok", medium: "paid_social" },
  { value: "whatsapp", label: "WhatsApp", medium: "chat" },
] as const;

export const UTM_MEDIUMS = [
  { value: "paid_social", label: "Iklan sosial (paid_social)" },
  { value: "cpc", label: "Iklan pencarian (cpc)" },
  { value: "social", label: "Posting organik (social)" },
  { value: "chat", label: "Chat (chat)" },
] as const;

export type UtmSource = (typeof UTM_SOURCES)[number]["value"];
export type UtmMedium = (typeof UTM_MEDIUMS)[number]["value"];

export const UTM_TAG_MAX_LENGTH = 100;

/** Lower-case hyphenated ASCII: `Promo Okt — Kopi Gayo!` → `promo-okt-kopi-gayo`. */
export function normalizeUtmTag(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, UTM_TAG_MAX_LENGTH)
    .replace(/-+$/, "");
}

export type UtmLinkInput = {
  page: string;
  source: string;
  medium: string;
  campaign: string;
  content?: string;
};

export type UtmLinkResult = { ok: true; url: string; campaign: string; content: string } | { ok: false; reason: string };

/**
 * The page URL with its UTM tags. Other query parameters on the page are kept;
 * any `utm_*` already there is replaced, so a copied link never carries two
 * campaigns.
 */
export function buildUtmLink(input: UtmLinkInput): UtmLinkResult {
  let url: URL;
  try {
    url = new URL(input.page);
  } catch {
    return { ok: false, reason: "Pilih halaman tujuan." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Pilih halaman tujuan." };
  if (!UTM_SOURCES.some((source) => source.value === input.source)) return { ok: false, reason: "Pilih sumber." };
  if (!UTM_MEDIUMS.some((medium) => medium.value === input.medium)) return { ok: false, reason: "Pilih medium." };
  const campaign = normalizeUtmTag(input.campaign);
  if (!campaign) return { ok: false, reason: "Isi nama kampanye (huruf atau angka)." };
  const content = normalizeUtmTag(input.content ?? "");
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  url.searchParams.set("utm_source", input.source);
  url.searchParams.set("utm_medium", input.medium);
  url.searchParams.set("utm_campaign", campaign);
  if (content) url.searchParams.set("utm_content", content);
  return { ok: true, url: url.toString(), campaign, content };
}
