import type { LucideIcon } from "lucide-react";
import type { AdminRole } from "../../lib/auth";
export type { AdminRole } from "../../lib/auth";
import {
  Activity,
  ChartNoAxesCombined,
  BadgeDollarSign,
  Boxes,
  CircleUserRound,
  ClipboardCheck,
  CodeXml,
  CreditCard,
  FilePenLine,
  LayoutDashboard,
  MessageCircle,
  Megaphone,
  Package,
  Puzzle,
  Settings,
  ShoppingBag,
  Truck,
  UserX,
  Warehouse,
} from "lucide-react";


/** Stable AdsBookCMS visual identity. Storefront tenant theming must not alter admin UI. */
export const ADMIN_ACCENT = "#2563eb";

export type AdminNavItem = {
  id: string;
  href: string;
  label: string;
  shortLabel?: string;
  description: string;
  icon: LucideIcon;
  keywords: string;
  children?: Array<{ href: string; label: string; icon?: LucideIcon }>;
};

export type AdminNavGroup = {
  label: string;
  items: AdminNavItem[];
};

export const adminNavGroups: AdminNavGroup[] = [
  {
    label: "Penjualan",
    items: [
      {
        id: "dashboard",
        href: "/admin/dashboard",
        label: "Dashboard",
        description: "Ringkasan performa toko",
        icon: LayoutDashboard,
        keywords: "dashboard ringkasan omzet performa",
      },
      {
        id: "orders",
        href: "/admin/orders",
        label: "Pesanan",
        shortLabel: "Order",
        description: "Validasi dan proses pesanan",
        icon: ShoppingBag,
        keywords: "orders pesanan transaksi pelanggan terbengkalai abandoned leads",
        children: [
          { href: "/admin/orders/abandoned", label: "Pesanan tertinggal", icon: UserX },
        ],
      },
      {
        id: "shipping",
        href: "/admin/shipping",
        label: "Pengiriman",
        description: "Kirim, pickup, dan resi",
        icon: Truck,
        keywords: "shipping pengiriman mengantar pickup resi",
      },
      {
        id: "products",
        href: "/admin/products",
        label: "Katalog",
        description: "Produk, varian, dan landing page",
        icon: Package,
        keywords: "products produk katalog varian stock landing pages",
        children: [
          { href: "/admin/landing-pages", label: "Landing page", icon: FilePenLine },
        ],
      },
    ],
  },
  {
    label: "Operasional",
    items: [
      {
        id: "expeditions",
        href: "/admin/expeditions",
        label: "Ekspedisi",
        description: "Kurir dan layanan aktif",
        icon: Boxes,
        keywords: "expedition kurir service rule",
      },
      {
        id: "scoring",
        href: "/admin/check",
        label: "Cek WA & Ongkir",
        description: "Riwayat pembeli dan tarif",
        icon: ClipboardCheck,
        keywords: "check scoring whatsapp ongkir tarif",
      },
    ],
  },
  {
    label: "Pemasaran",
    items: [
      {
        id: "analytics",
        href: "/admin/analytics",
        label: "Analitik",
        description: "Sumber pesanan, produk, wilayah, dan kampanye",
        icon: ChartNoAxesCombined,
        keywords: "analitik analytics laporan trend produk lokasi waktu utm kampanye campaign",
        children: [
          { href: "/admin/analytics", label: "Ringkasan" },
          { href: "/admin/analytics/landing", label: "Landing page" },
          { href: "/admin/analytics/products", label: "Produk" },
          { href: "/admin/analytics/locations", label: "Lokasi" },
          { href: "/admin/analytics/times", label: "Waktu beli" },
          { href: "/admin/analytics/utm", label: "UTM" },
        ],
      },
      {
        id: "ads",
        href: "/admin/ads",
        label: "Iklan & tracking",
        description: "Sinyal konversi iklan",
        icon: Megaphone,
        keywords: "ads pixel capi google tracking conversion utm link kampanye campaign",
        children: [
          { href: "/admin/ads/meta", label: "Meta Pixel & CAPI" },
          { href: "/admin/ads/google", label: "Google Ads" },
          { href: "/admin/ads/utm", label: "Link UTM" },
        ],
      },
    ],
  },
  {
    label: "Keuangan & sistem",
    items: [
      {
        id: "payments",
        href: "/admin/payments",
        label: "Pembayaran",
        shortLabel: "Payment",
        description: "Metode dan rekonsiliasi",
        icon: CreditCard,
        keywords: "payments autolaris bank virtual account qris saldo",
        children: [
          { href: "/admin/balance", label: "Rekonsiliasi", icon: BadgeDollarSign },
        ],
      },
      {
        id: "settings",
        href: "/admin/settings",
        label: "Pengaturan",
        description: "Toko, gudang, dan akses",
        icon: Settings,
        keywords: "settings system store warehouse crm access headless developer api plugin kelola whatsapp wa cs rotator nomor",
        children: [
          { href: "/admin/settings/store", label: "Toko & CS", icon: ShoppingBag },
          { href: "/admin/settings/whatsapp", label: "Nomor WhatsApp", icon: MessageCircle },
          { href: "/admin/settings/developer", label: "Headless API", icon: CodeXml },
          { href: "/admin/settings/warehouse", label: "Gudang", icon: Warehouse },
          { href: "/admin/settings/crm", label: "Template CRM", icon: FilePenLine },
          { href: "/admin/settings/access", label: "Akses Pengguna", icon: CircleUserRound },
          { href: "/admin/settings/plugins", label: "Plugin", icon: Puzzle },
        ],
      },
    ],
  },
];

export const profileNavItem: AdminNavItem = {
  id: "profile",
  href: "/admin/profile",
  label: "Profil & Integrasi",
  shortLabel: "Profil",
  description: "Akun, keamanan, dan API",
  icon: CircleUserRound,
  keywords: "profile akun password mengantar autolaris api domain",
};

/** Off the sidebar on purpose: the status icon beside the bell is its entry
 *  (PRD A39); the command palette finds it for owner and admin. */
export const statusNavItem: AdminNavItem = {
  id: "status",
  href: "/admin/status",
  label: "Status operasional",
  description: "Kesehatan sinyal dan setup toko",
  icon: Activity,
  keywords: "status kesehatan health setup operasional cron capi alert",
};

/** Menu items whose sub-pages are the item itself: each plugin's settings page
 *  lives under the plugin list (ADR-028). Every other item matches exactly. */
const NESTED_NAV_HREFS = new Set(["/admin/settings/plugins"]);

export function isAdminNavHrefActive(currentPath: string, href: string) {
  const base = "https://admin.local";
  const current = new URL(currentPath, base);
  const target = new URL(href, base);
  if (NESTED_NAV_HREFS.has(target.pathname) && current.pathname.startsWith(`${target.pathname}/`)) return true;
  if (current.pathname !== target.pathname) return false;
  for (const [key, value] of target.searchParams) {
    if (current.searchParams.get(key) !== value) return false;
  }
  return true;
}

export function getVisibleNavGroups(role: AdminRole) {
  if (role === "owner") return adminNavGroups;
  const visibleIds = role === "admin"
    ? new Set(adminNavGroups.flatMap((group) => group.items.map((item) => item.id)))
    : role === "advertiser"
      // "content" was here too, but no group defines that id any more - the page is
      // deliberately off the menu and reached from Pengaturan > Toko.
      ? new Set(["dashboard", "products", "analytics", "ads"])
      : new Set(["dashboard", "orders", "shipping", "scoring"]);
  return adminNavGroups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => visibleIds.has(item.id))
        .map((item) => role === "admin" && item.id === "settings"
          ? {
              ...item,
              children: item.children?.filter(
                (child) => child.href !== "/admin/settings/access",
              ),
            }
          : item),
    }))
    .filter((group) => group.items.length > 0);
}

export function getSearchableNavItems(role: AdminRole) {
  const groups = getVisibleNavGroups(role);
  return [
    ...groups.flatMap((group) =>
      group.items.flatMap((item) => [
        { ...item, group: group.label },
        ...(item.children ?? []).map((child) => ({
          ...item,
          href: child.href,
          label: child.label,
          description: item.label,
          icon: child.icon ?? item.icon,
          group: group.label,
        })),
      ]),
    ),
    ...(role === "owner" || role === "admin" ? [{ ...statusNavItem, group: "Akun" }] : []),
    { ...profileNavItem, group: "Akun" },
  ];
}
