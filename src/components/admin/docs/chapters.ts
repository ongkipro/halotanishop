/**
 * The admin Docs book (`/admin/docs/<slug>`): its chapters, in reading order,
 * in two parts. Text only — a screenshot of the admin goes stale with the
 * first UI change, a sentence naming the menu does not (Paduka, 2026-11-02).
 */
export const DOCS_PARTS = ["Panduan admin", "Integrasi API & CLI"] as const;

export const DOCS_CHAPTERS = [
  { part: 0, slug: "mulai", title: "Mulai di sini", summary: "Peran pengguna, dashboard, dan perjalanan satu pesanan dari masuk sampai terkirim." },
  { part: 0, slug: "pesanan", title: "Pesanan", summary: "Daftar dan detail pesanan, status, rilis ke kurir, lead, dan ekspor." },
  { part: 0, slug: "pengiriman", title: "Pengiriman & ekspedisi", summary: "Antrean kirim, resi, pickup, aturan kurir, dan cek ongkir." },
  { part: 0, slug: "pembayaran", title: "Pembayaran", summary: "COD, QRIS/VA, transfer manual, biaya admin, dan rekonsiliasi." },
  { part: 0, slug: "katalog", title: "Katalog & landing page", summary: "Produk, varian, harga, gambar, dan landing page." },
  { part: 0, slug: "iklan-analitik", title: "Iklan & analitik", summary: "Meta Pixel dan CAPI, Google, UTM, dan laporan Analitik." },
  { part: 0, slug: "pengaturan", title: "Pengaturan", summary: "Toko, WhatsApp CS, gudang, template CRM, akses pengguna, dan plugin." },
  { part: 1, slug: "integrasi", title: "Integrasi: mulai di sini", summary: "Tiga cara menghubungkan sistem lain ke toko, dan kapan memakai yang mana." },
  { part: 1, slug: "api-key", title: "API key & scope", summary: "Membuat key, memilih scope, batas pemakaian, dan audit." },
  { part: 1, slug: "headless-api", title: "Headless API", summary: "Storefront eksternal: katalog, ongkir, checkout, status order, tracking." },
  { part: 1, slug: "ops-api", title: "Operations API", summary: "Membaca order dari server, spreadsheet, atau agen: browse dan sinkronisasi." },
  { part: 1, slug: "cli", title: "CLI adsbook", summary: "Membaca order dari terminal: login, daftar, detail, output JSON." },
  { part: 1, slug: "error", title: "Error & batas", summary: "Kode error, header rate limit, dan cara menanganinya." },
] as const;

export type DocsChapterSlug = (typeof DOCS_CHAPTERS)[number]["slug"];
