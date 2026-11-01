/**
 * Splits one legal-page paragraph into text and links: `[label](/path)` for a
 * page of this store (internal paths only), an email address as `mailto:`,
 * and an international phone number (`+62…`) as a WhatsApp chat. Anything
 * else stays text, so a merchant's address or a stray bracket is never a link.
 */
export type LegalSegment = { text: string; href?: string };

const TOKEN = /\[([^\]]+)\]\((\/[^)\s]*)\)|([^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,})|(\+\d{8,15})/gi;

export function legalSegments(paragraph: string): LegalSegment[] {
  const segments: LegalSegment[] = [];
  let last = 0;
  for (const match of paragraph.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: paragraph.slice(last, index) });
    const [whole, label, path, email, phone] = match;
    if (label && path && !path.startsWith("//")) segments.push({ text: label, href: path });
    else if (email) segments.push({ text: email, href: `mailto:${email}` });
    else if (phone) segments.push({ text: phone, href: `https://wa.me/${phone.slice(1)}` });
    else segments.push({ text: whole });
    last = index + whole.length;
  }
  if (last < paragraph.length) segments.push({ text: paragraph.slice(last) });
  return segments;
}
