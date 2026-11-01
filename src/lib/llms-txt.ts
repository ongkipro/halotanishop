import type { Product } from "../data/products";
import { formatIdr } from "./format-idr.ts";

/**
 * `/llms.txt` (llmstxt.org): a plain-Markdown map of the store for an AI
 * assistant answering a shopper's question — what is sold, from what price,
 * how ordering works, and where the machine-readable data lives.
 *
 * Built only from this store's own tenant and catalogue (AGENTS.md §3). It
 * makes no claim the store has not configured: payment methods and shipping
 * terms vary per store and per area, so it points at the pages that state them
 * instead of listing them. No API, admin or order-status detail is published.
 */
export type LlmsTxtStore = {
  name: string;
  siteUrl: string;
  description?: string;
  tagline?: string;
};

const PRODUCT_LIMIT = 100;

const oneLine = (text: string, max = 160) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).replace(/[\s,.;:]+$/, "")}…` : clean;
};

export function buildLlmsTxt(store: LlmsTxtStore, products: readonly Product[]): string {
  const origin = store.siteUrl.replace(/\/$/, "");
  const summary = oneLine(store.description || store.tagline || `Toko online ${store.name}.`, 300);
  const listed = products.slice(0, PRODUCT_LIMIT);

  const productLines = listed.map((product) => {
    const from = Math.min(...product.variants.map((variant) => variant.price), product.price);
    const facts = [
      `mulai ${formatIdr(from)}`,
      product.brand ? `merek ${product.brand}` : "",
      product.category ? `kategori ${product.category}` : "",
      product.variants.length > 1
        ? `pilihan ${product.variants.slice(0, 6).map((variant) => variant.label).join(" / ")}`
        : "",
    ].filter(Boolean);
    // Only the merchant's own words: a generated description would repeat the
    // facts above.
    const about = product.catalogDescription;
    return `- [${product.productName}](${origin}/produk/${product.slug}): ${facts.join(", ")}.${about ? ` ${oneLine(about)}` : ""}`;
  });

  return [
    `# ${store.name}`,
    "",
    `> ${summary}`,
    "",
    `${store.name} adalah toko online berbahasa Indonesia; harga dalam Rupiah (IDR). Halaman produk adalah sumber harga, varian dan cara memesan yang berlaku.`,
    "",
    "## Cara memesan",
    "",
    "- Pesan langsung dari halaman produk: pilih varian, isi nama, nomor WhatsApp dan alamat lengkap.",
    "- Metode pembayaran dan ongkos kirim yang tersedia ditampilkan di form pesanan sesuai alamat tujuan.",
    "- Setiap pesanan dicek toko sebelum dikirim; toko dapat menghubungi pembeli lewat WhatsApp untuk konfirmasi.",
    "",
    "## Produk",
    "",
    ...(productLines.length ? productLines : ["- Katalog sedang diperbarui."]),
    ...(products.length > PRODUCT_LIMIT ? [`- [Semua produk](${origin}/produk): ${products.length} produk.`] : []),
    "",
    "## Informasi toko",
    "",
    `- [Tentang ${store.name}](${origin}/tentang)`,
    `- [Pengiriman](${origin}/pengiriman): area, kurir dan estimasi.`,
    `- [Kontak](${origin}/kontak)`,
    `- [Kebijakan privasi](${origin}/kebijakan-privasi)`,
    `- [Syarat dan ketentuan](${origin}/syarat-ketentuan)`,
    "",
    "## Data terstruktur",
    "",
    `- [Sitemap](${origin}/sitemap.xml)`,
    `- [Feed produk (Google Merchant, RSS 2.0)](${origin}/feed/google-catalog.xml)`,
    "- Setiap halaman produk memuat JSON-LD `Product` dengan satu `Offer` per varian.",
    "",
  ].join("\n");
}
