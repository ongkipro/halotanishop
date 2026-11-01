import { CMS_VERSION } from "@/lib/version";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ChangelogItem {
  title: string;
  description: string;
}

interface ChangelogRelease {
  version: string;
  date: string;
  releaseTag?: string;
  isLatest?: boolean;
  highlight: string;
  changes: ChangelogItem[];
}

// Written from the repository's own record (git history, RELEASE.md, BUILD-LOG)
// — an operator reads this as fact. The first entry is the running version:
// changelog.test.ts fails when version.ts moves without a matching entry here.
const CHANGELOG_RELEASES: ChangelogRelease[] = [
  {
    version: "1.8.2",
    date: "31 Oktober 2026",
    releaseTag: "2026.10-ops",
    isLatest: true,
    highlight: "Kategori Google resmi untuk setiap produk, form produk yang lebih rapi, dan logo login yang kembali ke beranda.",
    changes: [
      {
        title: "Kategori Google resmi",
        description: "Kategori Google dipilih otomatis dari nama produk (badge Otomatis), dengan saran lain yang tinggal diklik, atau cari sendiri dari taksonomi resmi Google dalam bahasa Indonesia (mis. sabun, serum wajah, cuka). ID-nya dikirim persis ke feed Google Merchant dan katalog Meta. Label kategori di toko terisi otomatis dan tetap bisa diubah. Merek kosong berarti nama toko.",
      },
      {
        title: "Kartu varian yang rapi",
        description: "Setiap varian punya kepala sendiri berisi nomor, ID varian (atau \"Baru\"), dan tombol hapus. Harga memakai awalan Rp, berat memakai gram, dan persentase hemat dari harga coret tampil otomatis.",
      },
      {
        title: "Logo login ke beranda",
        description: "Logo AdsBookCMS di halaman login kini bisa diklik untuk kembali ke beranda toko, di HP maupun desktop.",
      },
      {
        title: "Upload foto tarik-lepas",
        description: "Foto produk bisa ditarik ke kotak upload atau dipilih lewat tombol. Pratinjau, status mengunggah, serta tombol Ganti dan Hapus foto ada di satu tempat, lengkap dengan saran ukuran untuk feed Google dan Meta.",
      },
    ],
  },
  {
    version: "1.8.1",
    date: "31 Oktober 2026",
    releaseTag: "2026.10-ops",
    isLatest: false,
    highlight: "Halaman pembayaran dan terima kasih lebih jelas, feed Google lebih akurat, dan produk kini punya kategori, merek, serta deskripsi.",
    changes: [
      {
        title: "Salin nomor VA dan rekening lebih mudah",
        description: "Nomor VA dan rekening tampil penuh satu baris, dikelompokkan per 4 digit. Tombol salin ada di bawah nomor dan berubah jadi \"Tersalin\" saat ditekan. Nama penerima transfer tampil di baris sendiri.",
      },
      {
        title: "Halaman terima kasih yang klop",
        description: "Ringkasan pembayaran kini menampilkan biaya admin atau biaya layanan COD, jadi totalnya pas. Order VA/QRIS yang belum dibayar diarahkan ke instruksi pembayaran; hanya transfer manual yang diminta kirim bukti.",
      },
      {
        title: "Kategori, merek, dan deskripsi produk",
        description: "Form produk kini punya kolom Kategori, Merek, dan Deskripsi. Ketiganya tampil di halaman produk dan dikirim ke feed Google dan Meta. Isi untuk setiap produk agar feed tidak lagi memakai \"Umum\" dan nama toko.",
      },
      {
        title: "Feed Google dan SEO",
        description: "Harga di feed kini mengikuti varian termurah, sama dengan halaman produk, sehingga tidak ditolak Merchant Center karena harga beda. Data terstruktur produk diseragamkan, sitemap lebih jujur, dan toko kini punya /llms.txt untuk asisten AI.",
      },
    ],
  },
  {
    version: "1.8.0",
    date: "31 Oktober 2026",
    releaseTag: "2026.10-ops",
    isLatest: false,
    highlight: "Analitik lengkap, follow-up WhatsApp satu ketuk, multi-gudang, dan tampilan toko baru ala tema Shopify.",
    changes: [
      {
        title: "Analitik: landing page, produk, lokasi, waktu beli, dan UTM",
        description: "Menu Analitik kini punya enam laporan: Ringkasan, Landing page, Produk, Lokasi, Waktu beli, dan UTM (per source, medium, campaign, sampai content). Setiap baris bisa dibuka ke daftar order dengan periode yang sama. Iklan & tracking › Link UTM membuat link iklan bertag UTM yang konsisten.",
      },
      {
        title: "Follow-up WhatsApp satu ketuk",
        description: "Chip tahap follow-up (Welcome sampai FU 4) di daftar dan detail order membuka WhatsApp dengan pesan siap kirim dan langsung mencatat tahapnya. Salah ketuk bisa dibatalkan dari notifikasi, dengan alasan koreksi. Daftar order tampil lebih ringkas.",
      },
      {
        title: "Beberapa nomor WhatsApp CS",
        description: "Pengaturan › Nomor WhatsApp menyimpan lebih dari satu nomor CS. Pembeli COD di halaman terima kasih dibagi rata ke nomor yang aktif, dan bisa diarahkan otomatis ke chat setelah order.",
      },
      {
        title: "Multi-gudang dan pickup Mengantar",
        description: "Gudang tambahan bisa melayani provinsinya sendiri; bila ongkir dari gudang itu gagal, otomatis memakai gudang utama. Saat push ke Mengantar, pilih drop-off atau jadwal pickup (tanggal, jam, kendaraan). Paket drop-off punya antrean sendiri di Pengiriman: Perlu Drop-off.",
      },
      {
        title: "Push Mengantar yang aman dari paket ganda",
        description: "Bila hasil push tidak pasti (koneksi putus, atau Mengantar sudah menerima tetapi gagal tersimpan), order dikunci dan tidak bisa dipush ulang. Paket yang sudah diterima Mengantar cukup ditautkan dari detail order; owner atau admin melepas kunci hanya setelah memeriksa dashboard Mengantar.",
      },
      {
        title: "Ganti COD ke transfer atau VA dari detail order",
        description: "Order COD yang belum dikirim bisa dialihkan ke pembayaran transfer atau virtual account dari detail order. Bila instruksi pembayaran dibuat ulang, pembeli yang terlanjur membayar instruksi lama tetap tercatat lunas.",
      },
      {
        title: "Status operasional dan API operasional",
        description: "Ikon status di samping lonceng (owner dan admin) merangkum apakah ada yang perlu ditangani atau setup yang belum selesai, beserta waktu pembayaran dan Create Order terakhir serta antrean tertua. API operasional /api/ops/v1 dan CLI adsbook membaca order dengan API key ber-scope.",
      },
      {
        title: "Tampilan toko ala tema Shopify",
        description: "Tombol beli dan pilihan hitam, abu netral, label diskon biru. Header tidak lagi melekat: baris Official Store, logo toko (atau nama toko bila logo belum diunggah), dan ikon produk. Harga langsung di bawah judul kartu, breadcrumb satu baris dengan ikon, dan catatan ongkir serta tombol pesan ganda di halaman produk dihapus.",
      },
      {
        title: "Halaman kebijakan mengikuti pengaturan toko",
        description: "Kebijakan Privasi, Pengiriman & Retur, Syarat & Ketentuan, dan Kontak ditulis ulang untuk toko apa pun dan memakai nama toko, domain, WhatsApp, serta email dan alamat usaha baru di Pengaturan › Store. Kalimat yang datanya belum diisi tidak ditampilkan.",
      },
      {
        title: "Ikon, halaman masuk, dan menu akun baru",
        description: "Ikon AdsBookCMS baru untuk tab browser dan layar utama iOS (toko yang sudah memasang ikonnya sendiri tetap memakainya). Halaman masuk admin dirapikan: muat satu layar di HP dan desktop, dengan QRIS bercanda di sisi kiri (CMS gratis, server gratis). Tombol akun di kanan atas kini membuka menu: profil, pengaturan toko, storefront, catatan rilis, dan Keluar.",
      },
    ],
  },
  {
    version: "1.7.14",
    date: "29 Oktober 2026",
    releaseTag: "2026.10-plugins",
    isLatest: false,
    highlight: "Order lama yang belum pernah masuk Kelola kini bisa dikirim sekali klik.",
    changes: [
      {
        title: "Tombol Kirim order lama di plugin Kelola",
        description: "Webhook dan sinkron per jam hanya mengirim order 24 jam terakhir, jadi order dari sebelum Kelola disambungkan tidak pernah masuk. Halaman pengaturan plugin Kelola kini menampilkan jumlah order lama yang belum terkirim dan tombol Kirim order lama untuk mengirimnya. Order abandoned dan order yang dibatalkan tetap tidak dikirim.",
      },
    ],
  },
  {
    version: "1.7.13",
    date: "24 Oktober 2026",
    releaseTag: "2026.10-plugins",
    isLatest: false,
    highlight: "Transfer manual bisa dikonfirmasi dari detail order, dan Purchase-nya terkirim ke Meta.",
    changes: [
      {
        title: "Tombol Transfer Diterima",
        description: "Order transfer bank manual yang belum lunas kini punya tombol Transfer Diterima di kartu Pembayaran. Setelah dikonfirmasi, order berstatus lunas dan bisa dipush ke Mengantar. Sebelumnya order ini tidak bisa ditandai lunas dari dashboard.",
      },
      {
        title: "Purchase Meta untuk pembeli yang transfer lewat WhatsApp",
        description: "Konfirmasi itu langsung mengirim Purchase ke Meta lewat server (CAPI), memakai identitas iklan yang tersimpan saat checkout. Pembeli tidak perlu kembali ke halaman terima kasih. Nomor invoice yang sama dipakai sebagai event_id, jadi tidak pernah terhitung dua kali. COD tetap mengirim Purchase dari halaman terima kasih.",
      },
    ],
  },
  {
    version: "1.7.12",
    date: "24 Oktober 2026",
    releaseTag: "2026.10-plugins",
    isLatest: false,
    highlight: "Sitemap dan judul halaman lebih bersih untuk Google.",
    changes: [
      {
        title: "Slug iklan kedua tidak lagi masuk sitemap",
        description: "Landing page native yang memakai konten halaman lain (canonical ke halaman itu) bisa ditandai canonicalSlug di register. Sitemap hanya mencantumkan halaman aslinya, sehingga Google tidak melaporkannya sebagai duplikat.",
      },
      {
        title: "Nama toko tidak tertulis dua kali di judul",
        description: "Judul Kebijakan Privasi, Syarat & Ketentuan, dan Pengiriman tidak lagi menambahkan nama toko bila judulnya sudah memuat nama itu.",
      },
    ],
  },
  {
    version: "1.7.11",
    date: "23 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Halaman produk lebih cepat terbuka, termasuk saat dilayani dari server luar negeri.",
    changes: [
      {
        title: "Halaman produk membaca database lebih sedikit",
        description: "Katalog kini dibaca sekali per kunjungan dan bacaan yang tidak saling bergantung dijalankan bersamaan. Waktu tunggu halaman produk sebelum mulai tampil jadi lebih singkat, terutama bila Cloudflare melayani pengunjung dari server di Amerika.",
      },
      {
        title: "Worker berjalan dekat database (Smart Placement)",
        description: "Template wrangler.jsonc kini menyalakan Smart Placement. Toko yang sudah terpasang perlu menambahkannya di wrangler.jsonc sendiri; deploy preflight akan mengingatkan bila belum.",
      },
    ],
  },
  {
    version: "1.7.10",
    date: "23 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Panel Siapkan Toko kini memperingatkan saat tidak ada kurir aktif.",
    changes: [
      {
        title: "Langkah wajib: aktifkan minimal satu kurir",
        description: "Bila semua kurir dimatikan, checkout tidak bisa menghitung ongkir dan pembeli hanya melihat pesan gagal. Panel Siapkan Toko di dashboard kini menampilkan langkah ini dengan tautan langsung ke halaman Ekspedisi.",
      },
    ],
  },
  {
    version: "1.7.9",
    date: "23 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Checkout lebih tahan gangguan ongkir dan pilihan transfer lebih jelas.",
    changes: [
      {
        title: "Ongkir COD tetap muncul saat estimasi kecamatan gagal",
        description: "Bila estimasi ongkir ke kecamatan tujuan gagal, pembeli COD kini mendapat ongkir rata-rata kota yang dikonfirmasi admin, tidak lagi berhenti di pesan gagal. Pembayaran di muka tetap memakai ongkir kurir asli.",
      },
      {
        title: "Rekening transfer tampil lengkap",
        description: "Pilihan transfer bank kini menampilkan nama pemilik rekening di samping keterangan biaya. Toko dengan satu rekening atau satu bank Virtual Account menampilkannya langsung sebagai satu pilihan, tanpa harus membuka daftar terlebih dulu.",
      },
      {
        title: "Form lengkap mengenali provinsi pengunjung sejak awal",
        description: "Form lengkap kini menerima provinsi pengunjung seperti form ringkas, sehingga pilihan COD sesuai provinsi tampil tanpa jeda.",
      },
    ],
  },
  {
    version: "1.7.8",
    date: "22 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Pratinjau toko lewat alamat IP tidak lagi dialihkan ke domain toko.",
    changes: [
      {
        title: "Pratinjau lewat alamat IP",
        description: "Membuka toko lewat alamat IP, misalnya dari jaringan lokal atau Tailscale saat pengembangan, sebelumnya langsung dialihkan ke domain toko sehingga perubahan tidak bisa dilihat. Kini alamat IP diperlakukan sama seperti localhost. Pengunjung yang datang lewat domain tidak terpengaruh.",
      },
    ],
  },
  {
    version: "1.7.7",
    date: "22 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Toko bisa disembunyikan dari mesin pencari dengan satu pengaturan.",
    changes: [
      {
        title: "Opsi noindex untuk seluruh toko",
        description: "Pengaturan PUBLIC_SITE_NOINDEX=true membuat semua halaman toko tidak diindeks mesin pencari. Cocok untuk domain funnel iklan atau COD yang menjual produk yang sama dengan toko utama merek, supaya keduanya tidak bersaing di hasil pencarian. Iklan berbayar tetap berjalan. Tanpa pengaturan ini toko tetap diindeks seperti biasa.",
      },
    ],
  },
  {
    version: "1.7.6",
    date: "22 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Judul utama beranda tidak lagi diakhiri tanda pisah saat tagline kosong.",
    changes: [
      {
        title: "Judul beranda dan nama toko di header lebih rapi",
        description: "Toko tanpa tagline sebelumnya menampilkan judul utama beranda (dibaca mesin pencari dan pembaca layar) sebagai \"Nama Toko — \" dengan tanda pisah menggantung, begitu juga keterangan saat kursor diarahkan ke nama toko di header. Kini keduanya hanya berisi nama toko, atau nama toko dan tagline bila tagline diisi.",
      },
    ],
  },
  {
    version: "1.7.5",
    date: "22 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Header toko kini bisa menampilkan logo merek sendiri di samping nama toko.",
    changes: [
      {
        title: "Logo merek di header (opsional)",
        description: "Isi PUBLIC_SITE_BRAND_MARK dengan path gambar (misalnya /images/merek.svg) untuk menampilkan logo toko di samping nama toko pada header. Bila tidak diisi, header tetap memakai monogram huruf seperti sebelumnya, jadi toko lain tidak berubah.",
      },
    ],
  },
  {
    version: "1.7.4",
    date: "21 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Halaman produk kini disimpan di edge per provinsi dengan TTFB di bawah 0,3 detik.",
    changes: [
      {
        title: "Cache halaman produk & landing page per provinsi",
        description: "Halaman produk (/produk/<slug>) dan landing page kini disimpan selama 2 menit di edge Cloudflare berdasarkan kode provinsi pengunjung (Geo-IP). Pengunjung dari provinsi yang sama menerima halaman instan tanpa query database, sementara pemilihan form checkout (COD vs non-COD) tetap akurat sesuai provinsi masing-masing.",
      },
      {
        title: "Halaman dari cache langsung dijawab sebelum pengecekan skema D1",
        description: "Permintaan yang sudah ada di cache edge kini langsung dijawab sebelum Worker memeriksa tabel migrasi D1, memangkas jeda byte pertama (TTFB) pada isolate baru.",
      },
    ],
  },
  {
    version: "1.7.3",
    date: "21 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Foto produk yang diunggah tampil jauh lebih cepat.",
    changes: [
      {
        title: "Foto unggahan disimpan di edge Cloudflare",
        description: "Foto dari penyimpanan R2 sebelumnya dibaca ulang lewat Worker di setiap permintaan, sekitar satu detik sebelum byte pertama. Kini salinannya disimpan di edge selama sehari dan dikirim tanpa membaca database maupun R2. Foto yang dihapus berhenti tampil paling lambat dalam sehari.",
      },
    ],
  },
  {
    version: "1.7.2",
    date: "20 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Teks halaman benar-benar tidak lagi bergeser saat font dimuat.",
    changes: [
      {
        title: "Font Inter hanya dalam mode optional",
        description: "Font dipakai bila siap saat halaman pertama digambar; jika belum, halaman memakai font sistem sampai kunjungan berikutnya. Perbaikan 1.7.1 ternyata belum cukup karena aturan font bawaan paket masih ikut termuat dan menukar font; kini aturan itu dihapus. Hanya subset latin dan latin-ext yang dideklarasikan.",
      },
    ],
  },
  {
    version: "1.7.1",
    date: "20 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Teks halaman tidak lagi bergeser saat font dimuat.",
    changes: [
      {
        title: "Font tidak bertukar di tengah halaman",
        description: "Font Inter kini dipakai bila sudah siap saat halaman pertama digambar; jika belum, halaman memakai font sistem sampai kunjungan berikutnya. Judul dan paragraf tidak lagi melompat (CLS).",
      },
    ],
  },
  {
    version: "1.7.0",
    date: "20 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Halaman toko dan landing page terbuka lebih cepat, dan tidak lagi bergeser saat font dimuat.",
    changes: [
      {
        title: "Cache halaman dua menit",
        description:
          "Beranda, daftar produk, dan landing page disimpan sebentar di edge Cloudflare, sehingga pengunjung berikutnya tidak menunggu render ulang. Perubahan dari admin tampil paling lama dua menit kemudian. Halaman produk, form, terima kasih, dan admin tidak pernah di-cache, dan harga tetap divalidasi ulang saat order.",
      },
      {
        title: "Font dimuat lebih awal",
        description: "Font Inter dipreload sehingga judul tidak lagi bergeser saat font tiba (CLS).",
      },
    ],
  },
  {
    version: "1.6.5",
    date: "20 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Satu domain utama: domain lama dan http diarahkan otomatis, link iklan tetap jalan.",
    changes: [
      {
        title: "Domain lama diarahkan ke domain utama",
        description:
          "Domain lama toko (diatur lewat PUBLIC_ALIAS_HOSTS) diarahkan permanen ke domain utama, lengkap dengan path dan parameter iklan (UTM, fbclid). Webhook dan callback pembayaran tidak ikut diarahkan.",
      },
      {
        title: "Selalu HTTPS",
        description: "Kunjungan lewat http kini selalu diarahkan ke https, walau pengaturan zona Cloudflare belum mengaktifkannya.",
      },
    ],
  },
  {
    version: "1.6.4",
    date: "20 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Pembeli COD dari form singkat kini otomatis diarahkan ke WhatsApp CS dari halaman terima kasih.",
    changes: [
      {
        title: "Redirect WhatsApp untuk form singkat",
        description:
          "Order COD dari form singkat (middle) sebelumnya tidak pernah diarahkan ke WhatsApp walau pengaturannya aktif. Kini setiap order COD yang tercatat ikut diarahkan, setelah Purchase terkirim.",
      },
      {
        title: "Catatan nomor WhatsApp lebih jelas",
        description: "Halaman terima kasih kini menyebut bahwa CS akan menghubungi WhatsApp pembeli di nomornya sendiri.",
      },
    ],
  },
  {
    version: "1.6.3",
    date: "20 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Pesan WhatsApp CRM kini menyebut varian, jumlah, dan harga satuan yang dipilih pembeli.",
    changes: [
      {
        title: "Varian dan harga di Template CRM",
        description:
          "Variabel baru: {{varian}}, {{product_variant}}, {{jumlah}}, {{harga_satuan}}, dan {{rincian_pesanan}} (satu baris per item). Template bawaan memakainya; template yang sudah Anda ubah tetap seperti semula dan bisa ditambahkan variabelnya di Pengaturan → Template CRM.",
      },
      {
        title: "Harga coret tidak lagi dikarang",
        description:
          "{{compare_price}} kini memakai harga coret asli varian. Tanpa harga coret, nilainya sama dengan harga jual, tidak lagi harga × 1,3.",
      },
      {
        title: "Status tugas terjadwal di dashboard",
        description:
          "Panel kesehatan menampilkan apakah pemeliharaan per jam (retry CAPI, rekonsiliasi pembayaran, skor penerima, plugin) benar-benar berjalan.",
      },
    ],
  },
  {
    version: "1.6.2",
    date: "20 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Skor penerima Mengantar pulih sendiri setelah akun di-whitelist, termasuk di toko yang lama tidak menerima order.",
    changes: [
      {
        title: "Cek ulang otomatis setelah whitelist",
        description:
          "Order yang pernah ditolak Mengantar karena belum di-whitelist kini dicek ulang tiap jam berapa pun umurnya, jadi peringatan di dashboard hilang sendiri begitu akses aktif.",
      },
      {
        title: "Pesan penolakan lebih jelas",
        description:
          "Pesan dari Mengantar kini menyebut fitur yang ditolak (cek skor penerima) dan API key mana yang dipakai: dari dashboard atau dari secret server. Dengan begitu permintaan ke CS Mengantar tepat sasaran.",
      },
    ],
  },
  {
    version: "1.6.1",
    date: "20 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Halaman Kelola CRM lebih mudah dibaca saat ada order yang gagal terkirim.",
    changes: [
      {
        title: "Jumlah gagal berwarna merah",
        description: "Angka Gagal 24 jam di Kelola CRM kini merah setiap kali ada order yang belum diterima Kelola.",
      },
      {
        title: "Menu Plugin tetap tersorot",
        description: "Saat membuka pengaturan sebuah plugin, menu Pengaturan → Plugin di sidebar tetap tersorot.",
      },
    ],
  },
  {
    version: "1.6.0",
    date: "20 Oktober 2026",
    releaseTag: "2026.10-plugins",
    highlight: "Fitur opsional kini berupa plugin: tidak terpasang sampai toko mengaktifkannya.",
    changes: [
      {
        title: "Halaman Plugin",
        description:
          "Pengaturan → Plugin menampilkan fitur opsional toko. Owner memasang dan mengaktifkannya sendiri; menonaktifkan tidak menghapus data, dan Hapus data menghapus tabel plugin itu.",
      },
      {
        title: "Kelola CRM menjadi plugin",
        description:
          "Sambungan Kelola pindah dari Profil & Integrasi ke Pengaturan → Plugin → Kelola CRM. Toko yang tidak mengaktifkannya tidak membawa tabel maupun menu Kelola.",
      },
    ],
  },
  {
    version: "1.5.12",
    date: "19 Oktober 2026",
    releaseTag: "2026.10-landing-hero-h1",
    highlight: "Order dan pesanan tertinggal bisa dikirim otomatis ke Kelola CRM untuk ditindaklanjuti tim.",
    changes: [
      {
        title: "Order masuk ke Penjualan Kelola",
        description:
          "Tempel URL webhook dan secret dari Kelola (sejak 1.6.0 di Pengaturan → Plugin). Setiap order baru dikirim setelah checkout tanpa menunda pembeli, dicoba ulang tiap jam selama 24 jam, dan bisa dikirim ulang dari detail order.",
      },
      {
        title: "Pesanan tertinggal untuk follow-up",
        description:
          "Pesanan tertinggal yang 30 menit kemudian masih belum jadi order dikirim ke menu Data tertinggal di Kelola — terpisah dari Penjualan, jadi omzet tidak menggelembung.",
      },
      {
        title: "Halaman asal order",
        description: "Setiap order mencatat halaman (landing page) tempat pembeli memesan, terlihat di detail order.",
      },
    ],
  },
  {
    version: "1.5.11",
    date: "19 Oktober 2026",
    releaseTag: "2026.10-landing-hero-h1",
    highlight: "Landing page dengan HTML sendiri tidak lagi memicu request sia-sia setiap kali dibuka.",
    changes: [
      {
        title: "Gambar pemicu script tanpa request",
        description:
          "Gambar tersembunyi berisi onerror (src=\"x\") yang dipakai HTML landing untuk menjalankan script kini memakai data kosong. Script tetap berjalan, tetapi tidak ada lagi request 404 ke server di setiap kunjungan.",
      },
    ],
  },
  {
    version: "1.5.10",
    date: "16 Oktober 2026",
    releaseTag: "2026.10-landing-hero-h1",
    highlight: "Deploy ditolak bila akan menghapus landing page native yang sedang tayang.",
    changes: [
      {
        title: "Landing native dijaga saat deploy",
        description:
          "Sebelum deploy, preflight membandingkan landing page native di database produksi dengan daftar di kode. Bila ada yang tidak terdaftar, deploy ditolak karena sinkronisasi per jam akan menghapusnya.",
      },
    ],
  },
  {
    version: "1.5.9",
    date: "16 Oktober 2026",
    releaseTag: "2026.10-landing-hero-h1",
    highlight: "Setiap landing page punya tepat satu judul utama.",
    changes: [
      {
        title: "H1 dobel di HTML dijadikan H2",
        description:
          "Bila HTML landing page memuat lebih dari satu H1, hanya yang pertama tetap H1; sisanya menjadi H2 dengan tampilan yang sama.",
      },
      {
        title: "Landing tanpa judul tetap punya H1",
        description:
          "Landing page yang seluruhnya HTML tanpa H1 dan tanpa section headline kini memuat judul halamannya sebagai H1 tersembunyi untuk mesin pencari dan pembaca layar.",
      },
    ],
  },
  {
    version: "1.5.8",
    date: "15 Oktober 2026",
    releaseTag: "2026.10-landing-hero-h1",
    highlight: "Judul utama landing page tidak pernah dobel.",
    changes: [
      {
        title: "Satu H1 per landing page",
        description:
          "Bila section HTML sudah memuat judul H1, section headline tidak lagi ikut menjadi H1. Headline yang datanya rusak dan tidak tampil juga tidak dipilih sebagai judul utama.",
      },
    ],
  },
  {
    version: "1.5.7",
    date: "15 Oktober 2026",
    releaseTag: "2026.10-landing-hero-h1",
    highlight: "Gambar pembuka landing page tampil lebih cepat, dan judul pertamanya menjadi judul utama halaman.",
    changes: [
      {
        title: "Gambar pertama tidak lagi menunggu scroll",
        description:
          "Bila section pertama landing page adalah gambar, gambar itu dimuat langsung dengan prioritas tinggi. Gambar berikutnya tetap dimuat saat discroll.",
      },
      {
        title: "Landing page punya judul utama (H1)",
        description:
          "Section headline pertama kini dirender sebagai H1, jadi halaman — termasuk landing yang menjadi halaman produk — punya satu judul utama untuk mesin pencari. Tampilannya tidak berubah.",
      },
    ],
  },
  {
    version: "1.5.6",
    date: "15 Oktober 2026",
    releaseTag: "2026.10-fleet-status",
    highlight: "Deploy menolak bila database produksi punya migrasi yang tidak ada di kode.",
    changes: [
      {
        title: "Deploy tidak lagi bisa mematikan toko",
        description:
          "Sebelum upload, pemeriksaan deploy membandingkan migrasi yang sudah dijalankan di database produksi dengan file di kode. Bila ada yang hilang, deploy dihentikan dan nama migrasinya disebutkan.",
      },
      {
        title: "Skor penerima lebih hemat dan tahan salah",
        description:
          "Order yang baru ditolak Mengantar tidak dicek ulang setiap kali halaman dibuka, pengecekan per jam berhenti saat Mengantar lambat, dan ringkasan skor yang tidak wajar tidak lagi terbaca sebagai risiko tinggi.",
      },
    ],
  },
  {
    version: "1.5.5",
    date: "15 Oktober 2026",
    releaseTag: "2026.10-fleet-status",
    highlight: "Risiko RTS memberi tahu saat Mengantar menolak akses, dan menyusul sendiri setelah dibuka.",
    changes: [
      {
        title: "Akses skor penerima terlihat",
        description:
          "Mengantar kini membatasi cek skor penerima ke akun yang di-whitelist. Bila ditolak, detail order dan panel kesehatan dashboard menyebutkannya, dengan langkah meminta akses ke CS Mengantar.",
      },
      {
        title: "Skor resmi Mengantar",
        description:
          "Persentase dan nilai huruf (A sampai E-) diambil dari ringkasan skor Mengantar. Nomor tanpa riwayat tercatat sudah dicek, bukan lagi \"Belum dinilai\" selamanya.",
      },
      {
        title: "Menyusul otomatis",
        description:
          "Setiap jam, order 30 hari terakhir yang belum dinilai dicek ulang, sampai 20 per jam.",
      },
    ],
  },
  {
    version: "1.5.4",
    date: "12 Oktober 2026",
    releaseTag: "2026.10-fleet-status",
    highlight: "Notifikasi bukti sosial tidak menutupi layar pertama landing.",
    changes: [
      {
        title: "Layar pertama, bukan section pertama",
        description:
          "Di landing CMS, notifikasi menunggu sampai pembeli menggulir melewati layar pertama, apa pun isi section pertamanya. Landing yang seluruh isinya ditaruh dalam satu section kini juga menampilkan notifikasi.",
      },
    ],
  },
  {
    version: "1.5.3",
    date: "12 Oktober 2026",
    releaseTag: "2026.10-fleet-status",
    highlight: "Notifikasi bukti sosial di landing CMS ikut menghindari hero.",
    changes: [
      {
        title: "Seperti tombol sticky",
        description:
          "Landing CMS menyembunyikan notifikasi di atas hero dan di atas form, sama seperti landing native dan halaman produk.",
      },
    ],
  },
  {
    version: "1.5.2",
    date: "12 Oktober 2026",
    releaseTag: "2026.10-fleet-status",
    highlight: "Tampilan baru notifikasi bukti sosial.",
    changes: [
      {
        title: "Kartu yang lebih jelas",
        description:
          "Latar putih solid, jumlah pemesan ditebalkan dengan \"dalam 24 jam terakhir\" di baris kedua, dan ikon dengan penanda live yang berhenti berdenyut bila perangkat meminta gerak dikurangi.",
      },
      {
        title: "Aturan tetap",
        description:
          "Hanya order nyata, sekali per kunjungan, tersembunyi di hero, di form, dan saat pembeli mengisi form.",
      },
    ],
  },
  {
    version: "1.5.1",
    date: "12 Oktober 2026",
    releaseTag: "2026.10-checkout-tracking",
    highlight: "Event Meta dari browser tidak lagi hilang sebelum pixel siap.",
    changes: [
      {
        title: "Urutan pixel Meta",
        description:
          "ViewContent, AddToCart, InitiateCheckout dan Purchase dari browser menunggu inisialisasi pixel (dengan advanced matching), sehingga tidak ada event yang terbuang dan pasangan browser–server tetap cocok.",
      },
    ],
  },
  {
    version: "1.5.0",
    date: "11 Oktober 2026",
    releaseTag: "2026.10-checkout-tracking",
    highlight: "Semua perbaikan sejak 1.4.0 diberi nomor versi, ditambah pelacakan checkout dan tombol order mobile.",
    changes: [
      {
        title: "Tombol order di HP",
        description:
          "Tombol \"Buat Order\" selalu merespons ketukan: form kosong langsung memfokuskan field yang belum diisi, dan isian autofill langsung mengaktifkan tombol.",
      },
      {
        title: "Varian yang benar di order",
        description:
          "Bila SKU sebuah varian sama dengan id varian lain, id varian yang menang, sehingga order masuk dengan varian yang dipilih pembeli.",
      },
      {
        title: "Data ecommerce GA4/GTM",
        description:
          "Item di dataLayer membawa harga satuan dan jumlah, dan GTM noscript ikut terpasang.",
      },
      {
        title: "Kurir SPX",
        description:
          "SPX (Shopee Express) dari Mengantar tersedia di pengaturan ekspedisi.",
      },
      {
        title: "Kunci sesi otomatis",
        description:
          "Toko baru tidak perlu membuat AUTH_SECRET sendiri; Worker membuat kunci sesi admin pada pemakaian pertama.",
      },
      {
        title: "Redirect 301 landing ke halaman produk",
        description:
          "Landing yang dijadikan halaman produk dialihkan permanen (301) ke /produk/…, dan parameter iklan (fbclid, UTM) tetap terbawa.",
      },
      {
        title: "Form sesuai provinsi",
        description:
          "Semua landing memakai form hybrid: full form untuk provinsi tanpa COD atau yang tidak terbaca, middle form untuk lainnya — termasuk landing yang menjadi halaman produk.",
      },
      {
        title: "Arahkan pembeli COD ke WhatsApp",
        description:
          "Opsional di Settings → Store. Setelah pixel Purchase terkirim, halaman terima kasih membuka chat CS dengan nomor invoice, nama, produk dan varian.",
      },
      {
        title: "Ekspedisi",
        description:
          "Ninja dihapus. Toko baru dimulai dengan JNE dan J&T aktif; toko yang sudah berjalan tetap memakai pengaturannya.",
      },
      {
        title: "Pembayaran QRIS/VA",
        description:
          "Pengecekan otomatis per jam ke AutoLaris kini memeriksa transaksi baru dan yang baru kedaluwarsa, bukan terus transaksi lama.",
      },
      {
        title: "Kecepatan landing page",
        description:
          "Gambar landing CMS di bawah layar pertama dimuat belakangan, dan koneksi awal ke Meta/Google hanya dibuka saat pixel atau tag aktif.",
      },
      {
        title: "Sitemap dan beranda",
        description:
          "Landing native otomatis masuk sitemap dan beranda lewat pekerjaan terjadwal per jam, tanpa menunggu admin membuka daftar landing.",
      },
      {
        title: "Bukti sosial dan alert",
        description:
          "Notifikasi pembelian menampilkan jumlah order nyata 24 jam terakhir; alert operasional menyebut nama toko.",
      },
    ],
  },
  {
    version: "1.4.0",
    date: "27 Agustus 2026",
    releaseTag: "2026.08-stock-unlimited",
    highlight: "Stok tidak lagi menghalangi penjualan (ADR-023).",
    changes: [
      {
        title: "Tanpa batas stok",
        description:
          "Stok tidak dibaca saat checkout, konversi CS, maupun saat menentukan produk yang tampil; tidak ada yang mengurangi atau mengembalikan stok.",
      },
    ],
  },
  {
    version: "1.3.5",
    date: "27 Agustus 2026",
    highlight: "Perbaikan cepat daftar pesanan admin yang tampil kosong.",
    changes: [
      {
        title: "Daftar pesanan",
        description:
          "Halaman pesanan admin kembali tampil setelah perubahan komponen di 1.3.4 membuatnya kosong.",
      },
    ],
  },
  {
    version: "1.3.4",
    date: "27 Agustus 2026",
    highlight: "Penguatan pemulihan pembayaran setelah review independen.",
    changes: [
      {
        title: "Pemulihan pembayaran",
        description: "Perbaikan hasil review pada alur pembayaran ulang QRIS/VA.",
      },
    ],
  },
  {
    version: "1.3.3",
    date: "27 Agustus 2026",
    highlight: "Bukti callback pembayaran dan pemulihan dari halaman pembayaran.",
    changes: [
      {
        title: "Callback AutoLaris",
        description:
          "Setiap callback pembayaran dicatat sebagai bukti, tanpa mengubah status pembayaran.",
      },
      {
        title: "Halaman pembayaran",
        description:
          "Pembeli dapat menyalin link pembayaran dan meminta instruksi baru bila yang lama gagal atau kedaluwarsa.",
      },
    ],
  },
  {
    version: "1.3.2",
    date: "27 Agustus 2026",
    highlight: "Login dan pencarian kecamatan tidak lagi bergantung pada kuota KV (ADR-021).",
    changes: [
      {
        title: "Sesi dan rate limit di D1",
        description:
          "Sesi admin dan batas percobaan login disimpan di D1, sehingga login dan pencarian kecamatan tidak gagal saat kuota tulis KV habis.",
      },
    ],
  },
  {
    version: "1.3.1",
    date: "23 Agustus 2026",
    highlight: "Dua celah injeksi script ditutup.",
    changes: [
      {
        title: "Keamanan",
        description:
          "Judul halaman, tag og: dan data JSON di halaman di-escape, sehingga teks dari konten toko tidak bisa menjalankan script.",
      },
    ],
  },
  {
    version: "1.3.0",
    date: "22 Agustus 2026",
    releaseTag: "2026.08-landing",
    highlight: "Notifikasi operator dan landing page yang lebih lengkap.",
    changes: [
      {
        title: "Notifikasi operator",
        description: "Pemberitahuan di admin untuk kejadian pendapatan, seperti order baru.",
      },
      {
        title: "Landing page",
        description:
          "Landing page dapat menjadi halaman produk, dan landing native terdaftar di CMS.",
      },
    ],
  },
];

interface ChangelogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangelogModal({ open, onOpenChange }: ChangelogModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl md:max-w-2xl">
        <DialogHeader className="border-b border-slate-200 px-6 py-4 text-left">
          <div className="flex items-center justify-between pr-8">
            <DialogTitle className="text-base font-semibold text-slate-950">
              Catatan Rilis
            </DialogTitle>
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs font-medium text-slate-600">
              v{CMS_VERSION.version}
            </span>
          </div>
          <DialogDescription className="text-xs text-slate-500">
            Dokumentasi pembaruan fitur, optimasi performa, dan catatan arsitektur AdsBookCMS.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {CHANGELOG_RELEASES.map((rel) => (
            <section
              key={rel.version}
              className="border-b border-slate-100 pb-6 last:border-b-0 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="font-mono text-sm font-semibold text-slate-950">
                  v{rel.version}
                </h3>
                {rel.isLatest && (
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-xs font-medium text-white">
                    Aktif
                  </span>
                )}
                <span className="text-xs text-slate-400">·</span>
                <time className="text-xs text-slate-500">{rel.date}</time>
                {rel.releaseTag && (
                  <>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="font-mono text-xs text-slate-400">
                      {rel.releaseTag}
                    </span>
                  </>
                )}
              </div>

              <p className="mt-1.5 text-xs text-slate-600">
                {rel.highlight}
              </p>

              <ul className="mt-3 space-y-2 text-xs text-slate-700">
                {rel.changes.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 leading-relaxed">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-300"
                      aria-hidden="true"
                    />
                    <div>
                      <strong className="font-medium text-slate-900">
                        {item.title}:
                      </strong>{" "}
                      <span className="text-slate-600">{item.description}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <DialogFooter className="border-t border-slate-200 bg-slate-50/70 px-6 py-3 sm:flex sm:items-center sm:justify-between">
          <div className="text-xs font-mono text-slate-500">
            {CMS_VERSION.coreEngine} · Schema v{CMS_VERSION.schemaVersion}
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="sm" type="button">
              Tutup
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
