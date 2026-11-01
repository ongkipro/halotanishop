# Mengantar Integration — Technical Contract and Gap Register

> Verified against disk: 2026-10-31 @ `93d78a8` + feat/mengantar-pickup working tree (§5 C and §6 pickup; other sections retain their recorded evidence)

This document is the technical source of truth for AdsBookCMS behavior at the Mengantar boundary. It separates repository-observed transport code, locally verified application behavior, operator-gated live mutations, and provider contracts that remain unknown.

AdsBookCMS installs as **one Worker = one store**, so every statement below describes a single install's provider credentials and D1 database. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the install model and [`DECISIONS.md`](./DECISIONS.md) (ADR-001, ADR-002) for why there is no tenant abstraction in code.

Normative product behavior lives in `PRD.md` (`REQ-40`–`REQ-46`). Earlier revisions of this line cited `REQ-38`, `REQ-74`, `REQ-75` and `REQ-76`, none of which exist, and `REQ-13`–`REQ-16`, which are about home content, templates, feeds and ratings. Current evidence lives in `STATUS.md`; genuine remaining work lives in `UNIMPLEMENTED_SPECS.md` and in the gap register in `ARCHITECTURE.md` §10.

## 1. Boundary and Authentication

### Observed repository contract

- Production base URL default: `https://api-public.mengantar.com`.
- API prefix: `/api/public/{API_KEY}`.
- The store resolves its Mengantar API key and HTTP(S) base URL from D1 first, then from server environment fallback (`getProviderConfig`).
- Public browser code never receives the API key.
- JSON order creation uses `Content-Type: application/json`.
- Pickup address and time mutations use `Content-Type: application/x-www-form-urlencoded`. **[verifikasi]** The Mengantar documentation repository (`~/Projects/mengantar-documentation`, `docs/01-api-reference.md` §4.1) shows `POST /time` as JSON; neither encoding has a recorded live response.
- **Every** request made through `MengantarClient.requestJson()` sets `x-client-source: directCall` unless the caller has already supplied that header (`src/lib/mengantar-client.ts`). This is shipped, live behavior asserted by `src/lib/mengantar-client.test.ts`. Do not remove or rename it without confirming the provider's expected integrator classification first — the header is part of the active integration contract, not a proposal.
- Requests are bounded by an `AbortController` timeout configured on the client instance.

### Security and isolation

- Provider credentials belong to one install's Worker/D1 pair and must not be copied to another install.
- Read APIs must not echo raw keys. Admin configuration exposes only configured/source state and masked values.
- Unknown provider responses, unauthenticated callbacks, and unrecognized status values fail closed.
- Live order, pickup, wallet, or payment mutations require explicit side-effect approval.

## 2. Endpoint Status Matrix

Status distinguishes three separate things: whether the **transport method** exists on `MengantarClient`, whether an **application path** calls it, and whether an **operator UI** can trigger it.

| Provider endpoint | Method | Purpose | AdsBookCMS status | Active boundary |
| --- | --- | --- | --- | --- |
| `/address/search?keyword=` | `GET` | Resolve Mengantar area identities | Implemented and locally verified | Public checkout starts with the bundled district index; server/admin flows resolve provider district/subdistrict data before quoting or dispatch. |
| `/address` | `GET` | List seller pickup addresses | Transport implemented | `getPickupAddresses()` exists; provider synchronization is not presented as complete. |
| `/address` | `POST` | Create or update pickup address | Implemented (`PRD.md` REQ-44) | `createPickupAddress()` exists. Persist provider-confirmed identity only after an accepted response. |
| `/time` | `POST` | Schedule pickup | Implemented (`PRD.md` REQ-44) | `schedulePickupTime()` exists. A local D1 schedule is not provider confirmation. |
| `/time?address=` | `GET` | List pickup times | Transport implemented | `getPickupTimes()` exists; no complete synchronized admin lifecycle is claimed. |
| `/order/estimate` | `GET` | Quote retail courier services | Implemented and locally verified | Read-only quote used by checkout, order editing, and admin tariff checks; a quote is never a shipment. |
| `/order/allEstimate3PL` | `GET` | Quote base 3PL pricing | Not implemented | No transport method, application path, or UI. |
| `/getReceiverScoreByNumberUser` | `GET` | Return receiver history per courier and a `summary` score | Implemented; **whitelisted per account** | Mengantar answers `403 Not allowed` to accounts it has not whitelisted (provider docs, observed 2026-10-15 on a live key). Access is requested from Mengantar CS. See §4. |
| `/order` | `POST` | Create provider order/draft and optional waybill | Implemented; live mutation gated | Only explicit eligible Push actions in Order Management may invoke it. Bulk calls run sequentially with per-order outcomes. |
| `/order/pay-unpaid` | `POST` | Recover accepted non-COD unpaid draft | **Transport implemented and unit-tested; no operator UI** | `payUnpaidOrder(batchId, courierCode)` exists in `src/lib/mengantar-client.ts` and is covered by `src/lib/mengantar-client.test.ts`. It is called by no route and no admin component, so the recovery workflow cannot be triggered in production. See §5F. |
| Wallet balance | Unknown | Read active Mengantar wallet | Blocked | No canonical endpoint or response schema is verified; do not assume `/user/balance`. |
| `/order?tracking_id=` | `GET` | Reconcile one provider-created shipment by waybill | Implemented and locally verified; active-account read not exercised | An explicit Shipping action processes at most 50 rows sequentially, persists raw provider evidence, and allows only monotonic local lifecycle advances. |

## 3. Area Search and Quote Resolution

### Public checkout

1. `GET /api/locations?search=<prefix>` searches the bundled 7,285-district index (`src/data/indonesia-districts.ts`, derived from Kepmendagri No. 300.2.2-2138 Tahun 2025) without exposing provider credentials.
2. The customer selects one district plus city; public checkout does not require village selection.
3. The server resolves a representative Mengantar destination area identity through `/address/search` using the selected district plus city, not the ambiguous district name alone. Exact district representatives rank ahead of village rows. The answer is kept in D1 (see *Stored area resolution* below), so a district already resolved costs no Mengantar call.
4. `/api/shipping-options` requests eligible rates from `/order/estimate`.
5. Order submission re-fetches and verifies courier, service, cost, weight, active variant, and destination before persistence.

The local district index improves public search relevance; it is not a replacement for the provider identity required by rates and dispatch.

**Quote origin and pickup, per warehouse (ADR-032).** A store keeps up to ten
warehouses, each with its own Mengantar `origin_area_id` (a precise
sub-district) and its own `pickup_address_id` registered through `POST /address`
(`ensurePickupAddress`). A warehouse missing either is "not ready" and is never
chosen. Each quote sends `/order/estimate` one `origin_id`: the chosen
warehouse's — the active, ready one serving the buyer's province, else one on
the same island group, else the primary. When a non-primary warehouse's
estimate fails or returns no usable rate, the quote sends one more estimate
from the primary and uses it (REQ-270, ADR-032 amendment); a warehouse named
by `warehouse_id` and headless checkout do not. The order stores the warehouse that quoted;
dispatch sends `POST /order` the pickup address of `orders.warehouse_id`, and
`/time` schedules pickups per warehouse. No extra provider call is made to
choose, and a store with one warehouse sends the same origin and pickup as
before A42. An explicit `warehouse_id` (admin re-quote, headless checkout) is
honoured only while that warehouse is active and ready, or the primary.

**Courier catalogue.** Mengantar removed Ninja from its public API on
2026-09-01. Migration `0056` disabled its rule and `0061` removes it; the code
no longer names it. No install had an order with it; an order that did would
keep its `courier_code` and show it as written. Quotes are filtered through
`courier_rules`, so a quote for a courier without a rule is dropped.

A fresh install enables **JNE and J&T** only; every other courier in
`DEFAULT_COURIER_RULES` gets a row switched off, for the operator to turn on in
`/admin/expeditions`. Existing stores keep their own policy.

SPX (Shopee Express) is quoted as `spx` in `/order/estimate?courier=all`
(observed 2026-09-25; not yet in Mengantar's documentation) and is in
`DEFAULT_COURIER_RULES`; migration `0059` adds it to existing stores. Its quote
carries an extra `unsupportedOriginSpx` flag, treated like `unsupported`. The
estimate key is sent unchanged as `courier` on `POST /order`, as for every
other courier; Mengantar confirmed `spx` there, but the single-courier estimate
rejects it (`Invalid courier`), so the first live SPX dispatch is the evidence
still owed.

**Pos Indonesia COD eligibility.** Mengantar refuses a COD `pos` order with
`403` and `status` `new_seller`, `insufficient` or `blocked` when the account's
delivered rate is under 82% (rolling 21–60 days, all couriers); the quote does
not reveal it. `MengantarClient` raises `MengantarPosCodIneligibleError` for
exactly those three statuses, dispatch records the reason and delivered rate on
the order, and sets `is_cod_enabled = 0` on the Pos rule so checkout stops
offering a COD Pos that cannot ship. Pos stays available for prepaid. The
operator re-enables it once the rate recovers; nothing re-enables it
automatically.

**City-average fallback (`ICO`).** When no real rate is eligible for a COD
order, one city-average placeholder is offered and the operator assigns a real
courier before dispatch. It is never offered to a prepaid order: the admin
cannot reroute a paid online order, so it could never have shipped.

### `/api/locations` parameters

`src/pages/api/locations.ts` reads `search`, `level`, `province`, and `city`.

- `search` is required and must be at least two characters after trimming; anything shorter returns an empty list.
- `level` is **not an enum**. The handler branches on exactly one value: `level === 'resolve'`. Any other value — including no value at all — takes the same default path. There is no `level=district` mode; passing it is indistinguishable from omitting the parameter.
- `level=resolve` **with** a `city` value builds multi-attempt provider searches (`buildProviderDestinationSearches`), stops early once a district/city match resolves, and returns `resolved` rows with `alternatives` as fallback. The default path instead runs one provider search and applies `sortLocationResults`.
- `level=resolve` with a `city` reads `mengantar_areas` first and answers a stored row with no Mengantar call; only a miss runs the provider searches above.
- Without a D1 binding, the handler degrades to the bundled district catalog only. Without a configured Mengantar API key, a stored district still answers from `mengantar_areas`; anything else degrades to the catalog.
- Free-text (non-resolve) provider searches are not cached; before PRD A43 they wrote a 10-minute KV entry per query.
- Results are de-duplicated by ID and capped at 50 rows.

### Stored area resolution (PRD A43)

`src/lib/mengantar-areas.ts` owns D1 table `mengantar_areas` (migration `_mengantar_areas.sql`); nothing else reads or writes it. It replaced the 24-hour KV entry (`location-cache.ts`, deleted).

- **Key.** `district|city|province`, each part trimmed and lower-cased.
- **Sources.** `order-history`: seeded once by the migration from the store's own orders, the most frequent `destination_area_id` per district (ties: the most recent order), with `agreeing_orders` / `total_orders`. An order cannot tell an exact match from a fallback the form accepted, so a seeded row is dated by the newest order on its id, not by the migration: a district last ordered more than the bound ago starts stale and is resolved again on first use. A hit is composed from the request's district, city and province plus the stored id and postal code. `resolve`: a live resolve, whose exact response body is replayed byte for byte.
- **What is stored.** Only an exact district/city match (`resolveProviderDestinations` non-empty). A fallback answer — Mengantar does not know the catalogue district and offers a migrated kelurahan or same-city alternative, e.g. Jakabaring → Seberang Ulu I, 8 Ulu — and an empty answer are returned to the form but not stored, so they are asked again on the next resolve.
- **Bounded age.** A row answers for `MENGANTAR_AREA_MAX_AGE_DAYS` (30) from `resolved_at`; an older row is a miss and is resolved again: an exact answer replaces it, a fallback or empty answer deletes it, so a stale row (a seeded fallback included) never lingers. This bounds how long a retired or renamed area id can be served.
- **Drop on rejection (REQ-244).** `dropMengantarArea(areaId)` exists but has no caller: wiring it to an "area not found" answer from `/order/estimate` or dispatch touches `shipping-quote.ts` and `mengantar-dispatch.ts`, a protected surface held as TASKS A-415's proposal until approved.
- **Failure.** A D1 read or write failure is logged (`mengantar-area-read-failed` / `mengantar-area-write-failed`) and the resolve continues through Mengantar.

### Admin warehouse and order editing

- Warehouse origin selection groups provider results by district and then requires a precise subdistrict/village selection before persisting `origin_area_id` and its label.
- Customer checkout remains district-only and never displays kelurahan/desa in its delivery summary; the server still resolves a representative real Mengantar area ID for rates and dispatch.
- The order editor defaults to the same bundled district-plus-city search and resolves the selected pair to one representative provider area identity. An operator may explicitly enable direct provider kelurahan/desa precision when the buyer address needs it. Both modes persist a real `destination_area_id`, then re-quote the actual provider price; neither mode permits free-text or unresolved destination dispatch.

### Rate interpretation

- `unsupported: true` means the courier route is unavailable and must not be offered.
- `unsupported_cod: true` means the route may be available but COD must not be offered.
- AdsBookCMS persists and verifies the selected provider quote; browser-supplied cost is never authoritative.
- `/order/estimate` is a read operation. It does not create, reserve, or prove a shipment.

## 4. Receiver Performance

`GET /getReceiverScoreByNumberUser` returns courier-specific history (total, delivered, RTS, undelivered, in-progress counts and a 0–10 `rate` per courier) plus `data.summary`: `average_number`, the unweighted mean of the courier rates on a 0–10 scale (null without history), and `average_score`, a letter grade `A`…`E-`, prefixed `≈` when the counted couriers have fewer than four transactions, `-` when none. A receiver with no history returns empty courier objects and a null summary.

**Access is whitelisted per Mengantar account.** A key whose account is not whitelisted gets `403 {"success":false,"message":"Not allowed"}` while every other endpoint keeps working. From about 2026-10-06 every install's lookups were refused this way and orders silently stayed "Belum dinilai" (observed 2026-10-15: zvarashop `/address` 200, this endpoint 403; taniniaga and carukesi stopped scoring the same days).

Behavior:

- normalize the customer phone before the request;
- preserve the full courier breakdown and observation timestamp;
- with a `summary`, the delivery rate is `average_number × 10` and the grade is stored, so the risk matches what Mengantar shows; without one (older responses), delivered over completed outcomes across couriers;
- classify operational risk on the same 40/70 thresholds, as locally derived guidance;
- a receiver with no history is checked and `UNKNOWN`, not a parse failure;
- a `403 Not allowed` is `MengantarNotWhitelistedError`: the order keeps no label and stores `{"unavailable":"not-whitelisted","at":…}` so the order detail and the `receiver-score` health signal say why, and the manual refresh answers with the same message;
- the hourly cron backfills up to 20 unscored orders (not abandoned or cancelled) from the last 30 days, stopping at the first refusal (one call an hour for an account without access), after two other failures in a row, or after 30 seconds;
- an admin page view does not re-ask for an order refused within the last hour; the backfill is the retry path;
- a `summary.average_number` that is not a number in 0–10 is ignored and the rate comes from the counts, so a malformed summary never reads as 0 (HIGH);
- refresh checkout snapshots through Cloudflare `waitUntil()` so customer persistence does not wait on the read-only provider lookup;
- avoid fabricated fallback scores when the provider is unavailable.

## 5. Definitive Order-to-Shipment Lifecycle

### A. Intake

- Every checkout endpoint persists the order and its items atomically in D1. Stock is not read or written (ADR-023).
- Each order line records the variant's weight at that moment in `order_items.weight_grams` (migration `0070`): checkout copies it in the insert, and CS conversion of an abandoned lead copies it the same way.
- New orders use `shipping_status = pending` and remain in Order Management.
- COD, an eligible quote, and an authenticated AutoLaris paid transition do not call Mengantar automatically.

### B. Order Management verification

Before confirmation, the operator verifies:

- customer identity and deliverable address;
- resolved destination area identity and label;
- active warehouse and pickup data;
- selected supported courier/service and current public price;
- payment readiness: COD is not payment-gated unless its payment is void (`cancelled`/`refunded`/`failed` — never dispatchable), online methods require reconciled paid state, and a manual transfer requires the operator to mark it paid.

An explicit Push action in Order Management is the provider boundary. Selection alone is inert. Single and bulk actions call the Order Management API; Shipping does not create provider orders.

### C. Sequential dispatch from Order Management

- The backend validates ownership, pending status, payment eligibility, destination, warehouse, courier/service, and existing provider state again.
- The parcel weight sent to `/order` is the order's recorded weight, `COALESCE(order_items.weight_grams, product_variants.weight_grams)` per line: the weight the order was quoted with, falling back to the variant's current weight only for lines written before migration `0070`. Editing a variant after checkout does not change what dispatch sends. The Kelola plugin reads weight the same way. AutoLaris is a payment gateway only and is not changed.
- Each `/order` request is awaited before the next begins. Parallel calls and guessed fixed delays are prohibited.
- Every selected order returns an independent `success`, `unpaid`, `skipped`, or `failed` result with an actionable reason.
- Accepted siblings remain committed when another order fails.
- A clear provider rejection (4xx, `success:false`) clears the dispatch claim, preserves the provider error, and leaves the order `pending` in Order Management for correction and retry.
- An **unknown** outcome of `POST /order` — timeout, dropped connection, provider 5xx, or a 2xx whose body or shipment id cannot be read (`MengantarOutcomeUnknownError`) — may mean the shipment exists. The order is marked `DISPATCH_UNKNOWN: …`, refused by every push (eligibility, the dispatcher's early check, and the D1 claim), and shown on the order page with instructions; an owner or admin releases it (`release-dispatch-unknown`) only after finding no shipment at Mengantar. A failure before `POST /order` (a pickup slot that cannot be booked) is a plain failure. Audit 2026-10-31 M-1; a lookup by order number would let this resolve itself, but no such provider endpoint is confirmed.
- A stale dispatch claim becomes retryable after the same bounded lease used by the dispatcher.

### D. Provider-accepted Shipping projection

Only an explicit response with `success: true` may persist provider identity, set `shipping_status = processing`, record confirmation, and make the order visible in Shipping. Shipping owns:

- provider-returned resi visibility;
- shipment lifecycle status after creation;
- pickup selection and scheduling for eligible provider-created rows.

### E. Accepted response semantics

- Persist `provider_order_id`, batch identity, paid state, and `cnote_no` only for the individual accepted response.
- A provider-accepted non-COD draft may have `isPaid: false` and `cnote_no: null`.
- An absent `cnote_no` remains visibly absent; AdsBookCMS never fabricates a waybill or labels an unpaid draft as dispatched.

### F. Non-COD unpaid recovery — transport ready, workflow missing

The `/order/pay-unpaid` transport is **implemented**, not blocked:

- `payUnpaidOrder(batchId, courierCode)` posts `{ batch_id, courier }` as JSON to `/order/pay-unpaid`;
- it inherits the shared `x-client-source`, timeout, and response-parsing behavior of every other client method;
- `src/lib/mengantar-client.test.ts` asserts both the header and the call.

What is missing is everything above the transport: no API route calls `payUnpaidOrder()`, no Shipping or Order Management control exposes it, there is no persisted record of a recovery attempt, and no idempotency guard prevents a double payment if a retry raced. An operator therefore cannot recover an unpaid draft from the product today.

Before a recovery workflow ships, verify against the live account: the exact accepted/rejected response shape for a real unpaid draft, idempotency behavior on repeat calls, and what the provider returns when payment succeeds but waybill issuance is delayed or absent.

## 6. Pickup Synchronization

Observed client fields for `/address` include:

- `PICKUP_NAME`;
- `PICKUP_PIC`;
- `PICKUP_PIC_PHONE`;
- `PICKUP_ADDRESS`;
- `PICKUP_AUTOFILL` provider area identity;
- optional existing address identity for update.

`/time` fields (Mengantar docs, mirrored in `~/Projects/mengantar-documentation`): `address_id`, `date` in `mm-dd-yyyy`, and `time`, **one hour** from `9:00` to `18:00` (`"13:00"`). The `"9:00 - 18:00"` range this repository used to send was never a provider value; it came with the fork and no evidence supported it (fixed 2026-10-31, PRD A46). `POST /time` answers **one slot object** in `data`; `GET /time?address=` answers an array. `pickMengantarTimeId` reads either shape; the shipping page's former `data[0]` read always came back empty for the object.

### Pickup or drop-off at push (PRD A46)

`POST /order` carries `pickup.type`: `dropOff` (the default, and the only value sent before A46) or `scheduledPickup`, which also needs `time_id` (a `/time` slot `_id`) and `volume` (`volumeMotor` by default, `volumeMobil`, `volumeTruck`). The push dialog collects date, hour and vehicle; the dispatch resolves one slot per pickup address per request (an existing matching slot from `GET /time`, else `POST /time`), sends it with every order of that address, and links each accepted order to a local `pickup_schedules` row keyed by warehouse and provider slot id, so the shipping page does not list it as needing pickup.

Still **[verifikasi]** (open in the documentation repository's checklist): the exact server-accepted spelling of `scheduledPickup`/`dropOff` beyond `dropOff` (which live dispatch has used), the `GET /time` slot field names, and the error shape of a rejected pickup time. Confirm with one approved live order before relying on scheduled pickup in production.

### Pickup scheduling constraint — enforced in code

The 90-minute lead time is **not merely documented**; `src/pages/api/admin/shipping.ts` rejects the request before any provider call:

```ts
const minimumPickupTime = Date.now() + 90 * 60 * 1000;
```

A requested slot earlier than `now + 90 minutes`, or an invalid warehouse ID, returns HTTP 400 with the operator-facing message `"Slot pickup 09.00–18.00 WIB harus dimulai minimal 90 menit dari sekarang."`. The same handler validates the slot through `resolveMengantarPickupSlot()` and caps a batch at 1–100 shipments.

This is a locally enforced application rule derived from the available integration reference. It bounds our own requests; it is not proof that the provider applies the identical threshold. Confirm the provider-side minimum before relaxing or tightening the local value.

Remaining work for full pickup synchronization:

1. focused request/response verification for the active provider account;
2. explicit accepted/rejected/timeout handling;
3. provider identity persisted only after acceptance;
4. retry behavior that cannot duplicate pickup creation;
5. UI language that distinguishes local D1 schedule from provider-confirmed pickup.

## 7. Shipment Tracking Synchronization

Tracking is an authenticated, operator-triggered polling path; AdsBookCMS does
not assume that Mengantar sends callbacks.

1. `POST /api/admin/shipping` with `action: "sync-provider"` accepts either
   1–50 positive integer order IDs or selects up to 50 provider-created rows in
   `processing`/`shipped` state.
2. Each row is awaited sequentially. `MengantarClient.getOrderByTrackingId()`
   calls `GET /order?tracking_id=<cnote_no>` through the configured server-side
   credential and rejects an empty or missing result.
3. Only status-object entries whose value is exactly `true` count as active.
   Pickup/transit flags map to `shipped`; delivered-complete flags map to
   `delivered`; RTS/returned flags map to `returned`; otherwise the evidence
   remains `processing`.
4. The latest timestamped history entry supplies the operator-visible raw
   description and provider event time. D1 persists those values with the poll
   timestamp in `provider_status_text`, `provider_status_at`, and
   `provider_synced_at`.
5. `selectProviderShippingAdvance()` rejects regressions, same-rank changes, and
   any change from terminal `delivered`, `returned`, or `cancelled` state.
   Accepted advances run through `applyOrderLifecycleMutation()`, preserving the
   shared exactly-once release (void) marker.
6. One missing waybill, missing provider row, transport error, or failed
   persistence produces an independent result; it does not fabricate evidence
   or prevent sibling rows from completing.

The admin workspace exposes summary counts, search/date/status/courier filters,
pickup selection and history, provider description/event/sync timestamps,
loading/error/empty feedback, a desktop table, and mobile cards. Automatic
background retries and provider callbacks are intentionally absent: the
verified contract is explicit polling.

Live evidence still required is narrowed to representative accepted, missing,
malformed, timeout, shipped, delivered, and RTS responses from the active
account. The repository tests prove request construction, parsing, ordering,
persistence, and lifecycle behavior; they are not live-provider evidence.

## 8. Blocked Contract

### Live wallet balance

No canonical endpoint or response schema is verified. Before implementation,
obtain the endpoint and method, authentication, response schema, amount units,
currency, and error/stale-data semantics. Do not assume `/user/balance`.

## 9. Sandbox Reference

When an approved sandbox test is performed, preserve the known environment limitations as test preconditions rather than production rules:

1. JNE sandbox origin may require Jakarta mapping.
2. SAP sandbox tests may require non-COD Jakarta-to-Jakarta routing.
3. Sandbox wallet top-up may require the Midtrans sandbox simulator.

Re-check these constraints against the active sandbox documentation before treating a failure as an application regression.

## 10. Verification and Evidence Boundary

Repository-level proof currently covers payload construction, response parsing, eligibility, sequential execution, leases/claims, partial outcomes, persistence rules, local API behavior, and responsive single/bulk Shipping controls. Recent browser audits intentionally did not submit live provider mutations.

Relevant implementation owners:

- `src/lib/mengantar-client.ts` — transport, `x-client-source`, timeout, response parsing;
- `src/lib/mengantar-order.ts`;
- `src/lib/mengantar-dispatch.ts`;
- `src/lib/payment-dispatch-policy.ts` — payment eligibility for dispatch;
- `src/lib/location-search.ts` and `src/lib/district-catalog.ts` — area resolution helpers;
- `src/lib/mengantar-areas.ts` — stored kecamatan → area resolution (`mengantar_areas`);
- `src/data/indonesia-districts.ts` — the bundled 7,285-district index;
- `src/pages/api/admin/orders/[id].ts`;
- `src/pages/api/admin/shipping.ts` — pickup scheduling and the 90-minute rule;
- `src/db/migrations/0040_provider_shipping_status.sql` — persisted provider observation fields;
- `src/lib/order-lifecycle.ts` — atomic monotonic lifecycle and void/release boundary;
- `src/components/admin/ShippingOperations.tsx` — operator polling, evidence, filters, pickup, and responsive states;
- `src/pages/api/locations.ts`;
- `src/pages/api/shipping-options.ts`.

Run the repository's own commands rather than preserving historical counts:

```bash
npm test
npm run check
npm run build
```

A green unit test or build is not live-provider evidence. Record exact endpoint, side effect, request class, accepted/rejected outcome, and non-actions whenever a live scenario is explicitly approved.
