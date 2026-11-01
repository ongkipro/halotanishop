# Audit — 2026-10-31 — admin UI actions

> Verified against disk: 2026-10-31 @ `452b9be` (`feat/admin-topbar-polish`)

A point-in-time report, not a source of truth. It records findings only; every
fix is owned by the task, issue or document that takes it up. Product code was
not changed.

## 1. Scope and method

- Every admin page listed under `/admin` in `docs/ROUTE-MAP.md` (37 routes),
  plus `/admin/orders/[invoice]`, `/admin/products/edit?id=` and
  `/admin/landing-pages/[id]/edit` with real ids.
- Per page, at 1366 px and 390 px: HTTP status, final URL after redirects,
  rendered `main` text (an island that throws during SSR answers `200` with an
  empty body), empty `astro-island` elements, page errors, console errors and
  warnings, failed network requests and 4xx/5xx responses, and document-level
  horizontal overflow.
- Every action control on those pages was clicked in a real Chromium
  (Playwright, headless) and its effect confirmed: request and status, toast or
  status text, list or state change, persistence after reload where it mattered.
- Roles: an `advertiser` and a `customer_service` user were created through
  Pengaturan › Akses, logged in with the temporary password, forced to
  `/admin/profile`, changed the password there (`PUT /api/admin/profile`), then
  logged in again. For each role every admin page and 20+ admin APIs were
  requested.
- Destructive actions (order delete single/bulk/row, product delete, landing
  page delete, WhatsApp number delete, user revoke, password reset) ran last and
  only on seeded dummy data.

## 2. Environment

- Worktree `~/Projects/adsbookcms-audit-ui`, branch `audit/ui-actions-2026-10-31`
  from `origin/feat/admin-topbar-polish` (`452b9be`), `node_modules` symlinked.
- `npm run dev:local -- --reset --port=8797` (wrangler 4.120.0, workerd local,
  stand-ins for Mengantar/AutoLaris on 127.0.0.1:8798). Seeded with
  `npm run dev:seed -- --orders=12`, later `--orders=6` once more for extra
  dispatch-ready orders. Login `admin` (owner). Nothing reached a real provider;
  no `--remote`, no deploy.
- Gates, run once in the worktree:

| Command | Result |
| --- | --- |
| `npm test` | 1083 tests, 1083 pass, 0 fail, 0 skipped |
| `npm run check` | `astro check` 547 files, 0 errors / 0 warnings / 0 hints; `tsc --noEmit` clean |
| `npm run build` | exit 0 (only warning: missing `INSTALL_TOKEN` secret, expected for a template build) |

- Stability: the local Worker dropped with `Network connection lost`
  (the known wrangler 4.120 issue) about nine times, typically right after a
  slow response while host load average was 15–49 (many other `wrangler dev`
  processes were running on the machine). Each time it was restarted with
  `--no-build` on the same state and the step was repeated. Two 500s observed
  during the audit (`/api/admin/abandoned-orders`, `/api/form-config`) were
  the crash itself; both endpoints answered 200 on retry and are not findings.
- The provider stand-ins keep state in memory. After a restart, shipments
  dispatched earlier (INV-10001, INV-10002) failed sync with "Data tracking
  Mengantar tidak ditemukan" and "Cek AutoLaris" answered "TRANSAKSI TIDAK
  DITEMUKAN". Those are environment artefacts, not findings.

## 3. Page results

All rows: status 200, no empty island, no page error, no console error, no
failed request, no document-level horizontal overflow at 390 px, as owner.
Redirects are noted.

| Page | 1366 | 390 | Note |
| --- | --- | --- | --- |
| `/admin` | ok | ok | → `/admin/dashboard` |
| `/admin/dashboard` | ok | ok | |
| `/admin/orders` | ok | ok | |
| `/admin/orders/INV-10001`, `INV-10003` | ok | ok | |
| `/admin/orders/abandoned` | ok | ok | empty list (no abandoned leads seeded) |
| `/admin/shipping` | ok | ok | |
| `/admin/couriers` | ok | ok | → `/admin/shipping` |
| `/admin/check` | ok | ok | |
| `/admin/expeditions` | ok | ok | |
| `/admin/products`, `/new`, `/edit?id=82065` | ok | ok | |
| `/admin/landing-pages`, `/new`, `/[id]/edit` | ok | ok | |
| `/admin/content` | ok | ok | |
| `/admin/analytics` + `/landing` `/locations` `/products` `/times` `/utm` | ok | ok | |
| `/admin/ads`, `/ads/google`, `/ads/meta`, `/ads/utm` | ok | ok | |
| `/admin/payments`, `/admin/balance` | ok | ok | |
| `/admin/status` | ok | ok | |
| `/admin/profile` | ok | ok | |
| `/admin/settings` + `/access` `/crm` `/developer` `/plugins` `/store` `/warehouse` `/whatsapp` | ok | ok | |
| `/admin/settings/plugins/kelola` | ok | ok | → `/admin/settings/plugins` (plugin not active) |

Role results are in §5.

## 4. Findings

Screenshots are in
`/tmp/claude-1000/-home-ongki-Projects-adsbookcms/8c8eb877-fde5-4fb3-b4c3-d0c73e5aeb04/scratchpad/shots/`
(abbreviated `shots/` below). File:line references were read in the code at
`452b9be`; anything not traced in code says so.

Counts: critical 0, high 2, medium 7, low 8.

### High

**H1. Customer-service operators send the default WhatsApp templates from the
order detail page.**
- Page / control: `/admin/orders/[invoice]`, Follow-up WhatsApp chips.
- Steps: as owner, prefix template 1 (Welcome) in Pengaturan › Template CRM with
  `AUDITMARK`; log in as `customer_service`; compare the Welcome chip on
  `/admin/orders` (row INV-10005) with the one on `/admin/orders/INV-10005`.
- Expected: both use the store's templates, store name and bank accounts.
- Actual: the list link starts `AUDITMARK Hai Rina…`; the detail link starts
  `Hai Rina…` (built-in default). FU 1 on detail ends with seller name
  "Toko Kami" instead of "Toko Dummy Lokal" and no bank account.
- Evidence: on the detail page `GET /api/admin/settings → 403` and
  `GET /api/admin/seller-bank-accounts → 403` for the CS session; both errors
  are swallowed. No screenshot: the evidence is the request log and the link
  text recorded in the run (the CS password was reset before a capture).
- Code (verified): `src/components/admin/OrderDetail.tsx:861-900` reads
  templates/store name from `/api/admin/settings` and accounts from
  `/api/admin/seller-bank-accounts`; `src/lib/auth.ts:116-126` does not grant
  either to `customer_service`. The list gets templates from the orders API
  (`OrdersTable.tsx:690`), which CS may read.

**H2. Follow-up messages send customers an admin URL and say the payment link is
missing when the order has one.**
- Page / control: `/admin/orders` and `/admin/orders/[invoice]`, chips
  Process / Finish (`{{order_details_link}}`) and FU 1–4 (`{{epayment_link}}`).
- Steps: open INV-10005 (Virtual Account, unpaid; `payment_link` is
  `/payment#o=5&t=…`); read the Finish and FU 1 chip `href`.
- Expected: a customer-facing order link; the order's payment link.
- Actual: "Detail pesanan: /admin/orders/INV-10005" (relative, admin-only) and
  "Atau klik link berikut untuk pembayaran: Link pembayaran belum tersedia"; with
  no manual bank account, "Silakan lanjutkan pembayaran ke: Detail pembayaran /
  rekening bank" (placeholder text) is also sent.
- Evidence: `shots/F-wa-message-admin-link-no-payment-link.png`.
- Code (verified): `OrderDetail.tsx:946` passes `epaymentLink: ""` and `:947`
  `orderDetailsLink: "/admin/orders/…"`; `OrdersTable.tsx:1021` passes the same
  admin path; the list's `epayment_link` is only
  `payment_transactions.provider_payment_url`
  (`src/pages/api/admin/orders/index.ts:299-305`), never the order's own
  `payment_link`. Placeholders come from `src/lib/crm-template.ts:258-278`.

### Medium

**M1. Bulk "Ubah status ke…" reports double the count, in raw English, without
confirmation.**
- Page / control: `/admin/orders`, select INV-10012 + INV-10011, bulk bar
  "Ubah status ke…" → Batal.
- Expected: a confirm step before voiding orders (single and bulk delete both
  confirm), then "2 order … Batal".
- Actual: applied immediately; toast "4 order berhasil diubah ke status
  cancelled."; the Batal chip went 0 → 2 (two orders changed).
- Evidence: `POST /api/admin/orders 200`; `shots/s-bulk-03-bulk-after.png`.
- Code: `src/lib/order-lifecycle.ts:316-317` returns D1 `meta.changes`, which
  the AFTER UPDATE trigger from `src/db/migrations/0075_orders_updated_at.sql`
  doubles (one trigger UPDATE per row; the exact doubling matches, D1's
  counting itself was not read). Message text:
  `src/pages/api/admin/orders/index.ts:524` uses `update.status`.

**M2. A COD order voided by `payment_status = cancelled` reads as waiting.**
- Page / control: `/admin/orders` status chips and row; Aksi menu.
- Steps: `dev:seed` cancels INV-10004 with `PATCH /api/admin/orders/:id
  {payment_status:"cancelled"}` (`stock_restored_at` is set, so it is void).
- Actual: the row reads "Menunggu konfirmasi", counts under Menunggu, the Batal
  chip shows 2 while the dashboard reads "4 batal/gagal/retur"; the Aksi menu
  says "Pembayaran online belum lunas." for a COD order.
- Code: chips group by `shipping_status`
  (`src/pages/api/admin/orders/index.ts:474-487`); reason from
  `src/lib/payment-dispatch-policy.ts:79-90`. Not checked: whether any admin UI
  control (as opposed to the API or a provider callback) produces this state.

**M3. A follow-up chip shows a stray "0" after its step is undone.**
- Page / control: chips on `/admin/orders` and the detail page; toast
  "Batalkan" → "Simpan konfirmasi".
- Steps: tap FU 1 on INV-10008, undo from the toast with a reason, reload.
- Actual: the chip reads "FU 1 0" (list and detail).
- Evidence: `shots/F-crm-chip-zero-detail.png`, `shots/F-crm-chip-zero-list.png`;
  API returns `"completed":0`.
- Code (verified): `src/components/admin/CrmActionGroup.tsx:125,129` —
  `done && <span…>` with `done === 0` renders `0`.

**M4. Analitik drill-down to orders drops the period.**
- Page / control: `/admin/analytics/landing`, row "(tidak tercatat)".
- Actual: navigates to `/admin/orders?date_filter=this_month&source_slug=__none__`
  but the list requests `…&source_slug=__none__` without `date_filter` and shows
  all-time orders under a "Semua waktu" filter.
- Evidence: request log; `shots/s-analytics-09-landing-drill.png`.
- Code (verified): `src/lib/insights-view.ts:51-55` adds the period;
  `src/components/admin/OrdersTable.tsx:606-610` initialises the date filter to
  `all` and never reads it from the URL.

**M5. Drop-off shipments are queued as "Perlu pickup".**
- Page / control: order detail "Push Order ke Mengantar" → Drop-off → Kirim;
  then `/admin/shipping`.
- Actual: INV-10010 (drop-off) appears under PERLU PICKUP with "Siap
  dijadwalkan" and is counted in "Jadwalkan pickup (n)".
- Evidence: `shots/s-detailA-07-after.png`.
- Code (verified): the drop-off choice is not stored; `src/lib/shipping-queue.ts:30-35`
  treats every processing order with a waybill and no pickup schedule as
  needing pickup.

**M6. Konten: saving an untouched draft shows a raw validation dump.**
- Page / control: `/admin/content`, target Homepage (draft `{}`), "Simpan Draft"
  (enabled while "Publish Draft" is disabled).
- Actual: `PUT /api/admin/content 400`; the toast is the Zod issue array as JSON
  (`[{"code":"invalid_type",…"path":["hero"]…`). Same for a product target.
- Evidence: `shots/s-content-01-content-save-error.png`.
- Code (verified): `src/pages/api/admin/content.ts:20-21` returns
  `error.message` verbatim.

**M7. User edit and password-reset modals are not dialogs.**
- Page / control: `/admin/settings/access`, row Edit and Reset.
- Actual: no `role="dialog"`/`aria-modal`; Escape does nothing; focus stays on
  the row's Reset button and Tab moves to controls behind the overlay; the edit
  form labels are not associated with their inputs.
- Evidence: `shots/F-access-edit-modal-escape-ignored.png`.
- Code (verified): hand-rolled overlays at
  `src/components/admin/AccessManager.tsx:754` and `:832` (DESIGN-SYSTEM §7.1
  expects shadcn primitives).

### Low

**L1. Advertiser pages log a 403 on every load.** The topbar bell requests
`/api/admin/notifications`, which `advertiser` may not read; the bell then hides.
`src/components/admin/AdminShell.tsx:255` renders it for every role;
`src/lib/auth.ts:104-115` omits the route for advertiser. Console:
"Failed to load resource: … 403" on all 17 advertiser pages.

**L2. "Sinkronkan status" does not say which orders failed.** Banner
"Sinkronisasi selesai: 0 diperbarui, 6 tetap, 2 gagal dari 8 order."; the API
returns per-order errors, the rows still read "Sinkron belum pernah".
`src/components/admin/ShippingOperations.tsx:415`. Evidence
`shots/s-ship-08-fail.png` (banner visible).

**L3. Risiko RTS column reads "RTS Tinggi 16%" where 16% is the delivery success
rate** (3 delivered / 17 RTS for that phone). The aria-label is correct; the
visible pairing is not. `OrdersTable.tsx:489-510`. Evidence
`shots/F-rts-column-delivery-rate.png`.

**L4. Landing page duplicate toast is English:** "Landing page duplicated as
/promo-audit-madu-2-copy" (`src/pages/api/admin/landing-pages/index.ts:94`).

**L5. Landing page save error does not name the section:** "Teks section harus
diisi tanpa tanda < atau >." for empty sections (`src/lib/landing-pages.ts:382`).

**L6. Combobox trigger and clear buttons have no accessible name**
(`/admin/check` origin/destination, warehouse origin, order address dialog):
`src/components/ui/combobox.tsx:42-50` and `:73-81`.

**L7. Default FU 5 template typo** "mebutuhkan" (`src/lib/crm-template.ts:56`),
sent to customers as-is.

**L8. Narrow chip and column clipping at 1366 px.** Detail-page Welcome chip
renders "Welco…" (acknowledged in `CrmActionGroup.tsx` comment); on
`/admin/shipping` the last column's "Edit order" button is cut at the right
edge (`shots/s-ship-01-initial.png`). Whether the table scrolls internally was
not checked; the document itself does not overflow.

## 5. Roles

| Check | advertiser | customer_service |
| --- | --- | --- |
| First login with temporary password | → `/admin/profile`; other pages redirect there | same |
| API before password change | 403 `PERMISSION_DENIED` (route not granted) | 403 `PASSWORD_CHANGE_REQUIRED` |
| Password change via profile (`PUT /api/admin/profile`) | 200, session ended, re-login ok | same |
| Pages allowed and rendered | dashboard, ads ×4, analytics ×6, content, landing-pages ×2, products ×3, profile | dashboard, orders, order detail, abandoned, shipping, check, profile |
| Forbidden pages | redirect to `/admin/dashboard` (no message) | same |
| Forbidden APIs tried | orders, settings GET/PUT, access GET/POST, shipping, reconciliation, check, developer, warehouses, abandoned, notifications, expeditions, whatsapp, health, order PATCH/POST → all 403 | products, settings GET/PUT, access GET/POST, reconciliation, landing-pages, insights, developer, warehouses, ads, content, expeditions, whatsapp, health, seller-bank-accounts → all 403 |
| Allowed APIs | products, landing-pages, analytics, insights, ads, content → 200 | orders, shipping, analytics, check, abandoned, notifications, order detail → 200 |
| Side effects | L1 | H1 |

Not checked: clicking actions as either role (only page and API access).

## 6. Checked and passed

Orders list: status chips (Menunggu, Diproses, Dikirim, Batal, Semua), search by
name and by resi, period presets (Hari ini, Kemarin, 7 hari, Bulan ini), shipping
/ payment / traffic / landing filters and Reset, row Aksi menu per state,
"Cek Risiko RTS (Mengantar)", row "Push ke Mengantar" (dialog → Terkirim, list
refreshed), "Push semua yang siap" (dialog → 1 created), row selection, select
all, Batalkan pilihan, bulk delete with confirm, row delete with confirm.

Order detail: Salin invoice and Salin alamat (clipboard + toast), status menu,
Edit pembeli & alamat (rates loaded, PATCH, toast, persisted), Perbarui riwayat,
WhatsApp chips (open `api.whatsapp.com`, mark done, toast "Batalkan" opens the
correction dialog that requires a reason), Push dialog drop-off and pickup
(date and hour dropdowns, Motor/Mobil/Truk, stored `pickup_scheduled_at`
2026-11-01 18.00 WIB), payment switch COD → VA BCA (PATCH, toast, method and
payment link updated), Hapus with confirm (404 afterwards).

Shipping: Refresh, Sinkronkan status, queue cards, courier and status filters,
search, Reset, Jadwalkan pickup panel (row select, hour, note, Konfirmasi →
"2 pengiriman berhasil dijadwalkan pickup", rows "Terjadwal", history list).

Shell: dashboard period menu and refresh, notification bell (list, item opens
the order, "Tandai semua dibaca"), ⌘K (Ctrl+K and topbar button; Enter
navigates), status icon link, Lihat storefront, mobile nav sheet, Keluar
(session ends, admin pages redirect to `/hello`).

Catalogue: product tabs, search, category filter, copy Content ID (button and
menu), Aktifkan/Nonaktifkan switch, Embed checkout form (snippet copied), Lihat
di storefront, create product with image upload (WebP + card derivative),
validation of empty form, edit with second variant (persisted), delete with
confirm. Landing pages: create (title, slug, product, Headline/Paragraf/Bullet/
Form COD), save, edit and re-save (public page updated), Preview, tabs, source
filter, Duplikasi, Salin Link, Jadikan Produk Utama, copy URL, delete.

Ads & analytics: UTM builder (destination, source, medium, campaign, content,
Salin link → correct URL), Meta tabs, Simpan Meta, Google Simpan Konfigurasi,
both XML feeds (11 items), Analitik filters (kanal, halaman, produk, metrik),
slug Terapkan/Reset, sub-reports load.

Settings & money: Tes koneksi, Periksa konfigurasi, store profile save (persisted
and restored), storefront template form validation, embed origins, Template CRM
"Sisipkan" (inserts at caret) and save, WhatsApp number add / edit / deactivate
/ delete, warehouse edit-save, add (district search, save), deactivate,
Headless allowlist, API key generate / copy / revoke with confirm, AutoLaris
channel toggle, fee policy (online and COD, restored), Kelola rekening section,
Periksa konfigurasi channel, reconciliation tabs, refresh, Cek AutoLaris, manual
verification (amount, reference and checkbox validation, "Konfirmasi lunas di
CMS" → order paid and dispatch-eligible), expeditions region chips save,
courier service switch, tabs and search, Cek WA risk lookup, Cek tarif kurir,
Tukar asal dan tujuan, status Periksa ulang, content tenant instructions save,
access create ×2, search, role filter, Refresh, password reset, edit open,
revoke with confirm.

390 px: orders Aksi menu, push dialog (358 px wide), nav sheet, ⌘K, detail
chips, shipping pickup panel — no overflow.

## 7. Not checked

- **Would reach a real service:** "Generate Workers AI" (the `AI` binding is
  remote even under `wrangler dev --local`), Meta "Kirim test event" (Graph API),
  Kelola plugin "Pasang & aktifkan".
- **Would change credentials or lock out the session:** profile "Simpan
  Integrasi", owner password change.
- **Not exercised:** content "Upload ke R2", landing page image section and
  section move/delete buttons, storefront template "Tambah template" save,
  warehouse "Ganti" origin, payments menu items "Kelola kredensial API" and
  "Muat ulang konfigurasi", abandoned-order row actions (no abandoned leads in
  the seed), any action clicked as advertiser or customer_service, storefront
  checkout.
- **Seen once, not reproduced:** after "Push semua yang siap" the status chips
  stayed stale until reload; a single-row push refreshed the list correctly and
  no second push-all candidate remained to retry.
- **Stand-in limits:** sync and "Cek AutoLaris" results after a Worker restart
  (state lost); real courier pickup-day rules (the dialog offers Sunday 1 Nov).
