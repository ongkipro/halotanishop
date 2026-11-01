/**
 * The storefront's legal and contact pages, written for any store: no city,
 * courier, payment method, deadline or legal regime is named, because each
 * install is a different business in a different place. What does vary per
 * store comes from its settings (Pengaturan → Store) through placeholders:
 *
 *   {{store}}    store name           {{domain}}   the store's own host
 *   {{whatsapp}} first active CS number {{email}}  support email
 *   {{address}}  business address
 *
 * A paragraph whose placeholder the store has not set is dropped, never shown
 * half-filled, and a section left empty is dropped with it. `[label](/path)`
 * is a link, rendered by `LegalPage` (src/lib/legal-links.ts).
 *
 * Never add a promise the store has not made: a return window in days, a
 * delivery time, "we never sell data", a certification. Those belong to the
 * merchant, stated by the merchant; `legal-content.test.ts` refuses the known
 * ones.
 */
type LegalSection = { title: string; paragraphs: string[] };
type LegalTemplate = { badge: string; title: string; description: string; sections: LegalSection[] };

export const legalPages = {
  privacy: {
    badge: 'Kebijakan Privasi',
    title: 'Kebijakan Privasi {{store}}',
    description:
      'Bagaimana {{store}} mengumpulkan, memakai, dan menjaga data Anda saat Anda mengunjungi toko atau membuat pesanan.',
    sections: [
      {
        title: 'Tentang Kebijakan Ini',
        paragraphs: [
          'Kebijakan ini berlaku untuk toko online {{store}}. Dengan memakai toko atau mengirim pesanan, Anda memahami cara data Anda diproses seperti dijelaskan di sini.',
          'Situs resmi kami: {{domain}}.',
        ],
      },
      {
        title: 'Data yang Kami Kumpulkan',
        paragraphs: [
          'Data yang Anda berikan saat memesan: nama, nomor telepon atau WhatsApp, alamat pengiriman, produk dan varian yang dipilih, metode pembayaran, serta catatan pesanan.',
          'Data teknis saat Anda menjelajah: alamat IP, jenis browser dan perangkat, halaman yang dibuka, sumber kunjungan, serta cookie dan penanda iklan bila fitur tersebut diaktifkan oleh toko.',
        ],
      },
      {
        title: 'Cara Kami Memakai Data',
        paragraphs: [
          'Untuk mencatat dan memproses pesanan, menghitung ongkos kirim, menerima pembayaran, mengirim barang, dan menghubungi Anda tentang pesanan tersebut.',
          'Untuk melayani pertanyaan, keluhan, dan pengajuan retur; mencegah penipuan dan penyalahgunaan; serta memenuhi kewajiban hukum yang berlaku.',
          'Untuk memahami kinerja toko dan iklan secara agregat, sehingga produk dan layanan dapat diperbaiki.',
        ],
      },
      {
        title: 'Berbagi Data dengan Pihak Lain',
        paragraphs: [
          'Data hanya diteruskan sejauh diperlukan untuk menjalankan layanan: kepada penyedia pembayaran, jasa pengiriman, layanan pesan, analitik, atau platform iklan yang dipakai toko.',
          'Setiap penyedia memproses data sesuai ketentuan dan kebijakan privasinya sendiri. Data juga dapat diberikan bila diwajibkan oleh hukum atau permintaan resmi pihak berwenang.',
        ],
      },
      {
        title: 'Cookie',
        paragraphs: [
          'Toko memakai cookie untuk fungsi dasar, preferensi, dan pengukuran iklan. Rinciannya ada di [Kebijakan Cookie](/kebijakan-cookie). Anda dapat membatasi atau menghapus cookie melalui pengaturan browser.',
        ],
      },
      {
        title: 'Penyimpanan dan Keamanan',
        paragraphs: [
          'Data disimpan selama diperlukan untuk tujuan di atas, termasuk penyelesaian sengketa, pencegahan penyalahgunaan, dan kewajiban pencatatan menurut hukum.',
          'Akses ke data dibatasi dan dilindungi dengan pengamanan teknis yang wajar. Tidak ada sistem yang sepenuhnya bebas risiko, sehingga keamanan mutlak tidak dapat dijamin.',
        ],
      },
      {
        title: 'Hak Anda',
        paragraphs: [
          'Sesuai hukum perlindungan data yang berlaku bagi Anda, Anda dapat meminta akses, koreksi, atau penghapusan data, menarik persetujuan, atau keberatan atas pemrosesan tertentu.',
          'Permintaan dapat memerlukan verifikasi identitas dan tetap tunduk pada kewajiban penyimpanan yang berlaku.',
        ],
      },
      {
        title: 'Anak-Anak',
        paragraphs: [
          'Toko ini tidak ditujukan untuk anak di bawah usia yang disyaratkan hukum setempat untuk memberikan persetujuan sendiri, dan tidak dengan sengaja mengumpulkan data mereka.',
        ],
      },
      {
        title: 'Perubahan Kebijakan',
        paragraphs: [
          'Kebijakan ini dapat diperbarui sewaktu-waktu. Versi yang berlaku adalah yang ditampilkan di halaman ini.',
        ],
      },
    ],
  },
  shipping: {
    badge: 'Pengiriman & Retur',
    title: 'Pengiriman & Retur {{store}}',
    description:
      'Cara {{store}} memproses dan mengirim pesanan, serta cara mengajukan retur atau penggantian.',
    sections: [
      {
        title: 'Pemrosesan Pesanan',
        paragraphs: [
          'Pesanan diproses setelah data pesanan lengkap dan, untuk pembayaran di muka, setelah pembayaran diterima. Nomor resi dicatat pada pesanan begitu tersedia.',
        ],
      },
      {
        title: 'Area dan Biaya Pengiriman',
        paragraphs: [
          'Jangkauan pengiriman, pilihan kurir, dan layanan bergantung pada alamat tujuan dan berat pesanan.',
          'Ongkos kirim dihitung otomatis di formulir pemesanan dan ditampilkan sebelum pesanan dikirim.',
        ],
      },
      {
        title: 'Estimasi dan Pelacakan',
        paragraphs: [
          'Estimasi waktu tiba berasal dari jasa pengiriman dan bukan jaminan tanggal terima. Hari libur, cuaca, kapasitas kurir, dan kondisi wilayah dapat memengaruhinya.',
          'Gunakan nomor resi untuk melacak paket di kanal resmi jasa pengiriman terkait.',
        ],
      },
      {
        title: 'Bayar di Tempat (COD)',
        paragraphs: [
          'Bila tersedia, bayar di tempat hanya berlaku untuk tujuan, kurir, dan produk yang memenuhi syarat saat pesanan dibuat. Ketersediaannya ditampilkan di formulir pemesanan.',
        ],
      },
      {
        title: 'Barang Rusak, Salah, atau Kurang',
        paragraphs: [
          'Periksa paket segera setelah diterima. Bila barang rusak, salah, atau kurang, hubungi kami secepatnya dengan nomor pesanan serta foto atau video kondisi paket dan barang.',
        ],
      },
      {
        title: 'Pengajuan Retur',
        paragraphs: [
          'Hubungi kami sebelum mengirim barang kembali. Barang yang dikirim tanpa konfirmasi lebih dulu dapat tidak diproses.',
          'Kelayakan retur, alamat pengembalian, biaya kirim balik, dan batas waktu pengajuan dikonfirmasi oleh tim kami sesuai kondisi pesanan. Barang tertentu, misalnya yang sudah dipakai, dibuka segelnya, atau dibuat khusus, dapat tidak memenuhi syarat retur.',
        ],
      },
      {
        title: 'Penggantian dan Pengembalian Dana',
        paragraphs: [
          'Setelah retur disetujui dan barang diterima kembali, penyelesaiannya dapat berupa penggantian barang atau pengembalian dana. Bentuk, jumlah, dan waktu penyelesaian dikonfirmasi oleh tim kami.',
        ],
      },
    ],
  },
  tos: {
    badge: 'Syarat & Ketentuan',
    title: 'Syarat & Ketentuan {{store}}',
    description:
      'Ketentuan yang berlaku saat Anda memakai toko {{store}} dan membuat pesanan.',
    sections: [
      {
        title: 'Penerimaan Syarat',
        paragraphs: [
          'Syarat ini berlaku untuk pemakaian toko online {{store}} dan setiap pesanan yang dibuat melaluinya.',
          'Situs resmi kami: {{domain}}.',
          'Dengan memakai toko atau mengirim pesanan, Anda menyetujui syarat ini serta [Kebijakan Privasi](/kebijakan-privasi) dan [Pengiriman & Retur](/pengiriman).',
        ],
      },
      {
        title: 'Produk dan Harga',
        paragraphs: [
          'Kami berusaha menampilkan informasi produk, foto, dan harga dengan akurat. Warna dan tampilan dapat sedikit berbeda karena layar dan pencahayaan.',
          'Harga yang berlaku adalah yang tampil saat pesanan dibuat dan dihitung ulang oleh sistem. Bila terjadi kesalahan harga atau ketersediaan, kami dapat menghubungi Anda untuk konfirmasi atau membatalkan pesanan.',
        ],
      },
      {
        title: 'Pesanan dan Konfirmasi',
        paragraphs: [
          'Pesanan yang Anda kirim adalah permintaan pembelian. Pesanan dianggap diterima setelah dikonfirmasi oleh tim kami atau diproses untuk pengiriman.',
          'Pastikan nama, nomor yang dapat dihubungi, dan alamat pengiriman benar. Kesalahan data dari pemesan dapat menunda atau menggagalkan pengiriman.',
        ],
      },
      {
        title: 'Pembayaran',
        paragraphs: [
          'Metode pembayaran yang tersedia ditampilkan saat memesan. Untuk pembayaran di muka, pesanan diproses setelah pembayaran terverifikasi; instruksi yang melewati batas waktu dapat dibatalkan.',
        ],
      },
      {
        title: 'Pembatalan dan Perubahan',
        paragraphs: [
          'Perubahan atau pembatalan dapat diajukan sebelum pesanan dikirim. Pesanan yang sudah diserahkan ke jasa pengiriman mengikuti ketentuan [Pengiriman & Retur](/pengiriman).',
          'Kami dapat menolak atau membatalkan pesanan yang terindikasi penipuan, penyalahgunaan, atau tidak dapat dipenuhi.',
        ],
      },
      {
        title: 'Hak Kekayaan Intelektual',
        paragraphs: [
          'Nama toko, logo, foto, dan konten di toko ini milik {{store}} atau pemberi lisensinya, dan tidak boleh dipakai tanpa izin.',
        ],
      },
      {
        title: 'Batasan Tanggung Jawab',
        paragraphs: [
          'Sejauh diizinkan hukum, tanggung jawab kami atas suatu pesanan terbatas pada nilai pesanan tersebut. Kami tidak bertanggung jawab atas keterlambatan atau kegagalan akibat keadaan di luar kendali wajar, termasuk gangguan jasa pengiriman atau pembayaran.',
        ],
      },
      {
        title: 'Hukum yang Berlaku',
        paragraphs: [
          'Syarat ini tunduk pada hukum yang berlaku di wilayah tempat {{store}} menjalankan usahanya, tanpa mengurangi hak konsumen yang dijamin oleh hukum di tempat Anda.',
        ],
      },
      {
        title: 'Perubahan Syarat',
        paragraphs: [
          'Syarat ini dapat diperbarui sewaktu-waktu. Pesanan mengikuti syarat yang berlaku saat pesanan dibuat.',
        ],
      },
    ],
  },
  disclaimer: {
    badge: 'Disclaimer',
    title: 'Disclaimer {{store}}',
    description:
      'Batasan informasi yang ditampilkan di toko {{store}}.',
    sections: [
      {
        title: 'Informasi Storefront',
        paragraphs: [
          'Informasi produk berasal dari katalog yang diterbitkan pengelola toko. Periksa pilihan varian, harga, stok, dan detail pesanan sebelum mengirim formulir.',
          'Ketersediaan produk, tarif, estimasi pengiriman, dan hasil penggunaan dapat berubah sesuai kondisi transaksi dan penyedia layanan terkait.',
        ],
      },
    ],
  },
  contact: {
    badge: 'Kontak',
    title: 'Kontak {{store}}',
    description:
      'Hubungi {{store}} untuk pertanyaan produk, pesanan, pengiriman, pembayaran, atau pengajuan retur.',
    sections: [
      {
        title: 'Customer Service',
        paragraphs: [
          'Sertakan nomor pesanan bila pertanyaan Anda tentang pesanan tertentu, agar kami dapat membantu lebih cepat.',
          'WhatsApp CS: {{whatsapp}}',
          'Email: {{email}}',
        ],
      },
      {
        title: 'Alamat',
        paragraphs: ['{{address}}'],
      },
    ],
  },
} satisfies Record<string, LegalTemplate>;

export interface LegalPageContext {
  storeName?: string;
  supportWhatsapp?: string;
  supportEmail?: string;
  businessAddress?: string;
  /** The store's origin, e.g. https://tokosaya.com; shown as its host. */
  siteUrl?: string;
}

/** The pages that close with the store's own contact channels. */
const CLOSE_WITH_CONTACT = new Set<keyof typeof legalPages>(['privacy', 'shipping', 'tos']);
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** The host of a configured store URL; nothing for the unconfigured placeholder. */
function storeHost(siteUrl?: string) {
  if (!siteUrl) return '';
  try {
    const host = new URL(siteUrl).host;
    return host === 'example.com' ? '' : host;
  } catch {
    return '';
  }
}

/**
 * Legal copy is shipped as a template so a fresh install renders its own
 * identity instead of the name it was cloned from. Any paragraph whose
 * placeholder cannot be resolved is dropped rather than shown half-filled.
 */
export function getTenantLegalPage(
  key: keyof typeof legalPages,
  storeName?: string,
  context: LegalPageContext = {},
) {
  const page: LegalTemplate = legalPages[key];
  const values: Record<string, string> = {
    store: storeName || context.storeName || 'Toko Kami',
    domain: storeHost(context.siteUrl),
    whatsapp: context.supportWhatsapp?.trim() || '',
    email: context.supportEmail?.trim() || '',
    address: context.businessAddress?.trim() || '',
  };
  const resolvable = (text: string) => [...text.matchAll(PLACEHOLDER)].every(([, name]) => Boolean(values[name]));
  const fill = (text: string) => text.replace(PLACEHOLDER, (_, name: string) => values[name] ?? '');
  const hasContact = Boolean(values.whatsapp || values.email || values.address);

  if (key === 'contact' && !hasContact) {
    return {
      ...page,
      title: fill(page.title),
      description: 'Pengelola toko belum mempublikasikan kontak customer service.',
      sections: [
        {
          title: 'Kontak Belum Tersedia',
          paragraphs: ['Nomor WhatsApp, email, atau alamat customer service belum dikonfigurasi oleh pengelola toko.'],
        },
      ],
    };
  }

  const sections = page.sections.map((section) => ({
    ...section,
    title: fill(section.title),
    paragraphs: section.paragraphs.filter(resolvable).map(fill),
  }));

  if (CLOSE_WITH_CONTACT.has(key)) {
    sections.push({
      title: 'Hubungi Kami',
      paragraphs: hasContact
        ? [
            `Pertanyaan tentang halaman ini dapat disampaikan kepada ${values.store}:`,
            ...(values.whatsapp ? [`WhatsApp CS: ${values.whatsapp}`] : []),
            ...(values.email ? [`Email: ${values.email}`] : []),
            ...(values.address ? [`Alamat: ${values.address}`] : []),
          ]
        : ['Gunakan kontak yang tercantum di halaman [Kontak](/kontak).'],
    });
  }

  return {
    ...page,
    title: fill(page.title),
    description: fill(page.description),
    sections: sections.filter((section) => section.paragraphs.length > 0),
  };
}
