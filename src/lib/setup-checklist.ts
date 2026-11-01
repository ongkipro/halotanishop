import { getProviderConfig } from "./provider-config.ts";

/**
 * What a freshly installed store still needs before it can take an order —
 * the "first steps" panel a one-click install lands on after /install
 * (ADR-026). Derived from D1 on every render, so a step ticks itself the
 * moment the operator completes it; nothing is stored about the checklist.
 */
export type SetupFacts = {
  activeProducts: number;
  warehouseReady: boolean;
  mengantarConfigured: boolean;
  autolarisConfigured: boolean;
  activeBankAccounts: number;
  enabledCouriers: number;
  siteUrl: string;
};

export type SetupStep = {
  id: "product" | "warehouse" | "mengantar" | "couriers" | "payment" | "domain";
  label: string;
  hint: string;
  href: string;
  done: boolean;
  required: boolean;
};

function hasOwnDomain(siteUrl: string): boolean {
  try {
    const host = new URL(siteUrl).hostname;
    return !host.endsWith(".workers.dev") && host !== "example.com" && host !== "localhost";
  } catch {
    return false;
  }
}

export function buildSetupChecklist(facts: SetupFacts): SetupStep[] {
  return [
    {
      id: "product",
      label: "Tambah produk pertama",
      hint: "Harga, berat, dan foto dari sini yang dipakai checkout.",
      href: "/admin/products",
      done: facts.activeProducts > 0,
      required: true,
    },
    {
      id: "mengantar",
      label: "Sambungkan Mengantar",
      hint: "API key kurir: ongkir, COD, dan resi. Disimpan di database toko.",
      href: "/admin/profile",
      done: facts.mengantarConfigured,
      required: true,
    },
    {
      id: "warehouse",
      label: "Isi alamat gudang",
      hint: "Asal pengiriman untuk hitung ongkir dan pickup kurir. Butuh Mengantar tersambung.",
      href: "/admin/settings/warehouse",
      done: facts.warehouseReady,
      required: true,
    },
    {
      // Install seeds the default couriers, so this is open only when every one
      // was switched off: checkout then quotes nothing and the buyer sees only
      // "Ongkir belum berhasil dihitung", which reads like a provider outage.
      id: "couriers",
      label: "Aktifkan minimal satu kurir",
      hint: "Tanpa kurir aktif, checkout tidak bisa menghitung ongkir.",
      href: "/admin/expeditions",
      done: facts.enabledCouriers > 0,
      required: true,
    },
    {
      id: "payment",
      label: "Aktifkan pembayaran non-COD",
      hint: "Rekening bank untuk transfer manual, atau AutoLaris untuk QRIS/VA.",
      href: "/admin/payments",
      done: facts.autolarisConfigured || facts.activeBankAccounts > 0,
      required: false,
    },
    {
      id: "domain",
      label: "Pasang domain sendiri",
      hint: "Tambahkan di Cloudflare (Workers → Domains & Routes), lalu ganti alamat toko di sini.",
      href: "/admin/settings/store",
      done: hasOwnDomain(facts.siteUrl),
      required: false,
    },
  ];
}

/** Null when the facts cannot be read: no panel beats a wrong one. */
export async function readSetupFacts(
  database: D1Database | undefined,
  locals: App.Locals,
): Promise<SetupFacts | null> {
  if (!database) return null;
  try {
    const [products, warehouse, banks, couriers, providers] = await Promise.all([
      database
        .prepare("SELECT COUNT(*) AS total FROM products WHERE is_active = 1")
        .first<{ total: number }>(),
      database
        .prepare(
          `SELECT COUNT(*) AS total FROM warehouses
            WHERE TRIM(COALESCE(origin_area_id, '')) <> ''
              AND TRIM(COALESCE(pickup_address_id, '')) <> ''`,
        )
        .first<{ total: number }>(),
      database
        .prepare("SELECT COUNT(*) AS total FROM seller_bank_accounts WHERE is_active = 1")
        .first<{ total: number }>(),
      database
        .prepare("SELECT COUNT(*) AS total FROM courier_rules WHERE is_enabled = 1")
        .first<{ total: number }>(),
      getProviderConfig(database, locals),
    ]);
    return {
      activeProducts: Number(products?.total) || 0,
      warehouseReady: (Number(warehouse?.total) || 0) > 0,
      mengantarConfigured: Boolean(providers.mengantar.apiKey),
      autolarisConfigured: Boolean(providers.autolaris.apiKey),
      activeBankAccounts: Number(banks?.total) || 0,
      enabledCouriers: Number(couriers?.total) || 0,
      siteUrl: locals.tenant.siteUrl,
    };
  } catch (error) {
    console.error("setup-checklist-unreadable", error);
    return null;
  }
}
