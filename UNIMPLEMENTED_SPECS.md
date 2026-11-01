# AdsBookCMS — Remaining Work and Blockers

> Verified against disk: 2026-10-31 @ `7a8f26e` + fix/stack-review-2026-10-31 working tree (§1 audit 2026-10-31 rows, the UI-actions audit and AUD-R1; other rows retain their recorded evidence)

This is the single ledger of work that is **not** done. Implemented behaviour belongs in `STATUS.md`, history in `BUILD-LOG.md`, accepted product behaviour in `PRD.md`, real architecture in `ARCHITECTURE.md`, and constraining decisions in `DECISIONS.md`.

Two rules govern every entry, per ADR-010:

1. **Disk wins.** Code, migrations, runtime configuration, and executed evidence outrank this file. When they disagree, fix this file.
2. **A missing contract is not a licence to invent one.** An absent provider specification never justifies inferring an endpoint, payload, authentication method, retry policy, or status enum.

All ten structural gaps in `ARCHITECTURE.md` §10 are closed. This file now owns only audited defects, incomplete product surfaces, documentation debt, and external blockers.

---

## 1. Audited Engineering Gaps

| ID | Severity | Gap | Completion boundary |
| --- | --- | --- | --- |
| AUD-M2 | Medium | Delete and void ignore a payment instruction that is still live and a dispatch in progress (`order-lifecycle.ts:359-374`); a buyer who pays afterwards leaves money with no local record. `docs/AUDIT-2026-10-31.md` M-2. | Refuse or warn on delete/void while an instruction is live or a dispatch claim is held; a test that pays after void. |
| AUD-M3 | Medium | A paid order later cancelled is still uploaded to Google Ads as a conversion (`google-ads-offline.ts:302-315`). M-3. | A void guard in `reconcileGoogleAdsConversions`, with a test. |
| AUD-M4 | Medium | A failing schema upgrade stops the whole hourly cron, heartbeat and payment reconciliation included (`worker.ts:39`). M-4. | Isolate the upgrade so the other cron jobs still run and report it. |
| AUD-M5 | Medium | Meta CAPI `fetch` has no timeout and is awaited on request paths (`meta-capi.ts:180`); Google offline fetches too (L-11). M-5. | A bounded timeout on both, failure logged, request not held. |
| AUD-M6 | Medium | Two hourly queries scan all of `orders` (`rts-scoring.ts:150-163`, `google-ads-offline.ts:302`; `EXPLAIN` confirmed). M-6. | An index-backed bound, measured with `rows_read`. |
| AUD-M7 | Medium | `src/pages/api/admin/orders/[id].ts:39` imports the Kelola plugin directly instead of through `plugins/registry.ts` (ADR-028). M-7. | Route through the registry. |
| AUD-M8 | Medium | An admin status change is checked against an earlier read and written unguarded, so a cancelled or returned order can become active again (`orders/[id].ts:745-766`). M-8. | A guarded write through `order-lifecycle.ts`, with a concurrency test. |
| AUD-M9 | Medium | The payment-switch guard is tested only by a regex over source. M-9. | A behavioural test. |
| AUD-M11 | Medium | `OBSERVABILITY.md` states two different cron schedules. M-11. | One schedule, matching `wrangler.jsonc`. |
| AUD-M12 | Medium | Phone normalisers disagree; `0062…` becomes `62062…`. M-12. | One normaliser, tested on `0062`, `+62`, `62`, `08`. |
| AUD-R1 | Medium | A buyer who pays two AutoLaris instructions for one order is not detected. Once Advice or a manual confirmation settles one of them, the other (the live instruction moved to `payment_transaction_attempts` by an adopt, or an older one) is never asked about again: `SUPERSEDED_AUTOLARIS_INQUIRY_SQL` only reads orders still waiting for money (`autolaris-payment.ts`). Stack review 2026-10-31. | Recheck every unsettled instruction of a paid order until it expires, record a second payment as a refund case visible to the operator, with a test. |
| AUD-T-M1 | Medium | Google Ads offline upload uses `uploadClickConversions`, which since 2026-06-15 fails for a developer token that never uploaded before; every row would end `failed` on a new install (`google-ads-offline.ts:1`, `:241`). `docs/AUDIT-2026-10-31-tracking.md` M-1. | Move to the Data Manager API, verified against Google's current docs. |
| AUD-T-L | Low | Tracking lows: GTM loads before Consent Mode defaults (L-1), AddToCart/InitiateCheckout send the variant as product name (L-3), server PageView carries `value: 1` (L-4), every page posts `/api/meta-event` without Meta configured (L-5), the Google settings form keeps a stale error (L-7). | Each fixed or declined with a reason in the tracking audit's owner document. |
| AUD-PAY2 | Low | A buyer who pays both a replaced and a new AutoLaris instruction is not detected: the second payment's row is already `paid` (follow-on to H-1, fixed 2026-10-31). | Flag a paid attempt on an already-paid transaction for operator refund. |
| AUD-UI-M2 | Low | A pending order voided through its payment (`payment_status = cancelled`) keeps `shipping_status = pending`; the order list now shows, filters and counts it as Batal (fixed 2026-10-31), but the order detail, dashboard and Ops API still read the raw column. `docs/AUDIT-2026-10-31-ui-actions.md` M2. | The lifecycle write sets `shipping_status = cancelled` when a payment change voids a pending order, plus a forward migration for existing rows, with a test. |
| AUD-UI-TPL | Low | Follow-up templates print the placeholder "Detail pembayaran / rekening bank" to the buyer when the store has no active account and the order no snapshot. Links are fixed (H2, 2026-10-31); this text is not. | Omit the line, or warn in Template CRM when a template uses `{{bank_accounts}}` with no active account. |
| AUD-UI-L8 | Low | The detail page's Welcome chip still truncates to "Welco…" at 1366 px (the shipping table column was fixed 2026-10-31). | A label or layout that fits five chips per row at the narrowest supported width. |
| SCR1 | Low | The 2026-08-22 full-system screening proved the QRIS create path against AutoLaris but **not a settled payment**: capturing a paid `POST /api/h2h/advice` response means paying a real virtual account, so the confirmation path (`/thanks` replacement, paid-state gating, reconciliation marking an order paid) remains proven only by fixtures and the earlier manual-reconciliation browser smoke. It also did not exercise Mengantar dispatch (`POST /order`), which creates a real shipment and spends wallet balance, nor the Meta/Google outbound legs, which were verified by hand on 2026-08-19. | Prove the settled path once, deliberately, on a store that is ready to pay a small real amount, and record the observed `advice` response so `inquirePayment` can classify it. Dispatch stays a manual, operator-initiated action by design (A11) and should be screened against a provider sandbox if one is ever published. | **Narrowed 2026-09-09:** the capture that closes this is no longer discarded. `rc: "00"` arriving with a settlement word the allowlist does not recognise used to be counted as `unproven` beside genuine failures and thrown away — so the one observation this row waits for would have passed through unseen. It is now carried out of reconciliation as `unrecognisedPaidStatuses`, logged as `autolaris-paid-code-unknown-status` with the exact word and the order number, and included in the scheduled health log. The paid transition is unchanged and still requires both the code and an allowlisted word: a guess may not move money. What remains is the same as before — a real virtual account paid once — but the evidence will now be recorded when it happens rather than needing a deliberate experiment to catch it. **Vocabulary corrected 2026-09-09 against the provider's own documentation** (`ongkipro/autolaris`, `docs/guides/payment-gateway.md`): `SUCCESS` and `BERHASIL` were in the paid allowlist and the guide names both as too generic to mean settled, alongside the shipping word `DELIVERED`. §7 of the same guide settles why: `rc: "00"` means the API call succeeded, not the payment, so `00` with a generic success word is ambiguous — and resolving that toward paid marks an order paid that may not be. Both were removed; `PAID`, `SETTLED` and `LUNAS` remain as unambiguous settlement vocabulary. The provider still publishes no complete settlement mapping, so these three are a conservative reading rather than a confirmed contract.

**AD3** was closed on 2026-09-09, in two halves. The Google feed now declares
`identifier_exists: no` **alone**: the `g:mpn` it used to publish alongside
contradicted that declaration — one says the product carries no manufacturer
identifier, the other supplies one — and it was never truthful, because an MPN
is assigned by a manufacturer while `sku` is nullable, merchant-editable and
changes whenever an operator edits it. The earlier rationale, that the MPN kept
Merchant Center from rejecting an item for a missing global identifier, is the
job `identifier_exists: no` already does. Both feeds also clamp `title` and
`description` to what each platform accepts, because over a cap an item is
disapproved rather than truncated. The out-of-stock half is **not applicable
rather than blocked**: `mergeStorefrontCatalog` skips any product failing
`getPublicProductValidationError`, which requires at least one valid priced
variant, so a product with no sellable variant never reaches the catalog and
was never in the feed to disappear from.

**COD1** was settled on 2026-09-09 as what it always was: a pricing decision.
The local 3% + 11% VAT figure is the store's own COD service price, not an
attempt to mirror Mengantar's quoted `codFee`, and the consistent one-rupiah
spread is a consequence of rounding each component up rather than a bug.
`payment-fee-policy.ts` now says so at the constants, including the consequence
that a provider rate change does not move it.

**DOC1** was closed on 2026-09-09 by re-extracting `DESIGN-SYSTEM.md` from the
tree rather than restamping it. The drift was wider than this row recorded. §1.1
documented `#f8f7f4` as the storefront canvas with 49 uses and a `SiteHeader`
citation; it is not in the storefront at all, surviving only in the
landing-page stylesheets and `install.astro`. `#C5A880` survives in two CSS
header comments and `#8A704F` has zero occurrences. §4 described the checkout's
colours as hardcoded boutique hexes, but `form-hybrid.css` contains **zero**
`#C5A880` or `#F8F7F4` — every state resolves through `var(--sf-*)`, which is
what makes ADR-019's re-brand surface real. §1.2, §3, §5 and §8.12 all described
the `wide-catalog` template retired under ADR-018. §7.3 listed a deleted
`ProofsSection.astro` that §2.1 cited a line number inside and §3 sourced its
shadow rule from. §7.4 described a scroll-snap carousel with a thumbnail rail;
the component is 65 lines and scriptless. §8.2 attributed an emerald palette to
`/payment` and `/thanks`, where it now appears zero times.

Closed 2026-09-09: **S1** — `theme_color`, `locale` and `admin_name` are edited
at `/admin/settings/store`, validated against the very patterns
`resolveTenantConfig` resolves with (`THEME_COLOR_PATTERN`, `LOCALE_PATTERN`,
exported for exactly that reason), so a malformed value is refused at the form
rather than silently replaced by the default. **NOT1** — migration `0054`
stamps a per-operator notification floor at creation and one shared predicate
filters every read and every clear, so a newly added operator inherits no
backlog and clearing the badge claims none of it.

Closed by the A10 work and 2026-08-18 production hardening recorded in `BUILD-LOG.md`: canonical single/bulk order transitions; exactly-once void marking on cancellation/deletion (stock is no longer counted, ADR-023); paid or dispatched orders cannot be deleted; atomic order numbers; abandoned-order abuse controls and retention; bank-transfer verification; submit-boundary payment policy; canonical Meta Purchase identity and paid-state gates; runtime schema upgrades; fresh-install home composed from the store's own identity (ADR-025); runtime storefront definitions; Headless scopes, quotas, final-response audits, and public order status; per-install schema/CAPI alerting; one-time install capability; public provider rate limits with server-owned origin; and migration-owned settings schema.

---

## 2. Headless API Deliverables

Nine `/api/v1/*` routes ship with hashed developer keys, independent origin policy, minimum per-operation scopes, D1-backed per-key quotas, payload-free write audits, token-scoped public order status, and an authenticated OpenAPI 3.1 document at `/api/v1/openapi.json`. `STOREFRONT_INTEGRATION.md` §4 is the human-readable contract.

| ID | Item | Why it remains |
| --- | --- | --- |
| H9 | Cross-storefront consent handoff | No accepted merchant/legal contract defines how consent state crosses an external storefront handoff. Checkout must remain usable when tracking is declined or unavailable. |

---

## 3. External Provider Blockers

These cannot be closed from this repository alone. Each needs canonical provider documentation or an explicitly approved live capture.

| Subsystem | Missing contract | Verified boundary |
| --- | --- | --- |
| Mengantar tracking live proof | Accepted, missing, malformed, timeout, and representative shipped/delivered/RTS responses from the active account | Operator-triggered authenticated polling, sequential isolation, raw evidence persistence, and monotonic status mapping are implemented and locally tested. No callback contract is assumed; no live provider read was performed in this change. |
| Mengantar wallet | Canonical balance endpoint and response schema | `/admin/balance` is an AutoLaris D1 reconciliation ledger, not a provider wallet. |
| AutoLaris settled-payment shape | The response `POST /api/h2h/advice` returns for a transaction that has actually been paid, plus its expired and failed shapes | Superseded on 2026-08-19. The provider's published H2H collection documents `POST /api/h2h/advice` taking `{ "transaction_id": "..." }`, and it was exercised against the provider's published development key: a freshly created, unpaid transaction returns `{"rc":"02","ket":"PENDING","data":{"awb":""}}`. `AutoLarisClient.inquirePayment` implements that read and classifies **only** `rc: "02"` as `pending`; every other code is `unproven` and cannot move payment state. No settled transaction has been observed, because observing one means paying a real virtual account. **Since 1.4.x** the scheduled confirmation workflow is built: `reconcileAutoLarisPaymentStatuses` runs hourly and marks a transaction paid only on `rc: "00"` (`AUTOLARIS_PAID_CODE`) **with** an allowlisted settlement word (`PAID`, `SETTLED`, `LUNAS`); `02` stays pending and every other code is unproven. Manual confirmation remains as the audited fallback. What is still unobserved is a real settled response. The earlier entry claimed no read-only inquiry endpoint existed at all — it does. It also recorded `POST /api/h2h/submit` as the creation path, which was wrong for this product — `/submit` is the combined shipping-and-payment path and requires AutoLaris' own `id_area` district identifiers, which no order in this repository holds. **Since 1.3.3** every callback the provider delivers to `/api/webhooks/autolaris` is stored verbatim in `autolaris_callbacks` (A-164, ADR-022); once a settled one is on file its shape can be classified from evidence instead of a paid experiment. |
| AutoLaris Create Order (`POST /api/h2h/submit`), digital-product form | A live settled `/submit` response, and confirmation that `courir_id: 1` holds for any account other than this one | **Corrected 2026-09-09: this row said the workflow was "not wired". It is wired, and has been.** `createAutoLarisPayment` calls `/submit` as the checkout money path — `courir_id: 1`, `origin`/`destination` from `AUTOLARIS_ORDER_ORIGIN_ID`/`AUTOLARIS_ORDER_DESTINATION_ID`, weight summed from `order_items` × quantity, shipper from the warehouse, and the full `order_details` array. `create_payment` is called **nowhere** in the tree, so the guide's double-billing warning — never call Create Payment for a `reff_id` already processed by Create Order — is satisfied by construction rather than by discipline. `buildAutoLarisCreateOrderPayload` was checked field-for-field against the provider's canonical OpenAPI (`ongkipro/autolaris`, `openapi/autolaris-h2h.openapi.json`): all 24 keys match `CreateOrderRequest`, including `longitude`, `latitude` and `remark`, which are documented in `ShipmentFields` rather than invented. What remains unobserved is a **settled** `/submit` transaction, which is the same blocker as SCR1 and needs a real payment. The provider's guide is also explicit that `courir_id: 1` is an account convention, not a global Postman contract, so another account's integrator must confirm it before reuse. |
| AutoLaris `expired` timezone | Which timezone `payment_info.expired` is quoted in | The provider's reference lists this under "Batas kontrak" — not published. The client reads it as Jakarta (`+07:00`), which is the reasonable assumption for an Indonesian provider quoting local time, and `parseAutoLarisExpiry` now says so as an assumption rather than as a documented fact. If the provider actually sends UTC, every instruction would be treated as expiring seven hours late and `/payment` would present a dead virtual account as live. An unparseable value yields no expiry at all, which fails safely. Confirm before go-live. |
| AutoLaris production IP allowlist | Which egress addresses an install presents to AutoLaris | The provider's documentation requires production API access to be allowlisted to at most five IP addresses. Cloudflare Workers do not offer a fixed egress address, so no install can be declared AutoLaris-production-ready on this evidence. The development key is unrestricted, which is why every capture above was taken with it. This is an infrastructure decision, not a code change. |
| Mengantar unpaid recovery | Real insufficient-wallet response plus verified `/order/pay-unpaid` response shape, idempotency, and failure semantics | Automatic `/order/create` dispatch is a separate contract. A provider-created unpaid draft may retain its accepted provider order ID with no cnote and be visible under **Perlu Dibuatkan Resi**, but `MengantarClient.payUnpaidOrder` has no verified internal operator action. No local flow may fabricate or persist a waybill before provider acceptance. |
| Mengantar pickup proof | Current `/address` and `/time` schemas plus live accepted/rejected/timeout/duplicate evidence | Existing handlers already call provider-before-persist and leave D1 unchanged on provider failure. |
| Meta signal acceptance | Event Match Quality, event volume, and confirmed Purchase deduplication for a real order, read from Events Manager | The browser Purchase now matches on eight keys through the single `fbq('init')` MetaPixelBase owns, shares its `event_id` with the CAPI leg, and reports product value rather than the invoice — all asserted in tests and observed on the wire in a browser (BUILD-LOG 89–93). What no one has confirmed is that **Meta counted it once**, which is the claim the whole deduplication design rests on. Tasks **A-223**, **A-224**. |
| Meta catalog acceptance | Commerce catalog diagnostics for `/feed/meta-catalog.xml` | The feed is asserted against the Pixel's own `content_ids` rather than a fixture, and one unpublishable row no longer takes it down. It has never been ingested by Meta. Task **A-225**. |
| Google Ads offline acceptance | One `uploadClickConversions` call accepted, and the conversion visible in the account | The transport is contract-matched and unit-tested against `v25`, and the head-of-line block that stopped discovery entirely is fixed and covered by a D1 test (A-182). No call has ever been made to Google. Until then the offline leg is unproven end to end. It is no longer unmonitored: the `google-ads-outbox` health signal (A-227) and alert (2026-09-25) now report a stalled or failing queue. Tasks **A-227**, **A-228**, **A-230**. |
| Merchant Center acceptance | Feed fetch result and item-level diagnostics for `/feed/google-catalog.xml` | `ad-taxonomy.ts` derives `google_product_category` from the product's own text and omits it when unsure, which is the safe choice for approval; whether Google accepts those choices has never been observed. Task **A-231**. |
| EEA/UK measurement | A consent management platform calling `gtag('consent', 'update', …)` | `GoogleAdsBase.astro` defaults 32 EEA/UK regions to `denied` with `wait_for_update: 500`, and nothing in this repository ever sends the update — so a visitor from those regions stays denied for the whole session and is measured not at all. Deliberate for an Indonesian store, a hard blocker the moment one advertises into those regions. Task **A-229**. |

### Closing a blocked contract

1. Obtain the canonical specification or an explicitly approved capture: endpoint, authentication, schemas, status enum, retry/idempotency semantics, and replay window.
2. Implement inside the existing provider client or admin reconciliation boundary; do not open a second HTTP path.
3. Persist provider identifiers and confirmed state only after provider acceptance.
4. Keep local failure actionable; never present an unsynchronized D1 row as provider-confirmed.
5. Cover accepted, rejected, timeout, and retry paths with a runnable check.

---

## 4. Inherited Identity and Account-Coupled Copy

The setup guide in `src/pages/admin/ads/google.astro` now suggests `<store name> Purchase` instead of the inherited `Zanoby Purchase` (2026-09-25). Nothing in code matches on that name — offline uploads use `GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID` — so an account whose action is still called `Zanoby Purchase` keeps working; renaming it there is the account owner's choice.

The legacy `zanoby_click_ids` cookie remains a read-only 90-day attribution fallback by deliberate compatibility decision. New writes use `adsbook_click_ids`; remove the fallback only after the upgrade window has elapsed.

---

## 5. Operator-Gated Actions

These are not engineering gaps. They require an explicit human decision and, where relevant, a rollback plan.

| Action | Gate |
| --- | --- |
| Live Mengantar side effects — order creation, pickup address, pickup schedule, unpaid recovery | Exact side-effect approval |
| Live AutoLaris side effects — payment creation or payment-state mutation | Exact side-effect approval |
| Meta test events | Operator-provided test code plus explicit outbound-call approval |
| Remote D1 preflight (`npm run db:migrate:remote`) | Separate production-data approval; runtime auto-upgrade does not authorize it |
| Install-repository deployment | Explicit production approval; this product repository itself has no deploy target or credentials |
| Provisioning another Cloudflare account/install | Explicit infrastructure approval |
| Scrubbing local or remote warehouse/provider identifiers | Explicit destructive-data approval |

---

## 6. Execution Order

1. Observe one **settled** `POST /api/h2h/advice` response (SCR1). Automatic
   paid marking already runs hourly and requires `rc: "00"` **and** an
   allowlisted settlement word (`autolaris-client.ts`); the first real
   settled word either confirms the allowlist or lands in
   `unrecognisedPaidStatuses`. Owner/admin manual confirmation stays the
   audited fallback.
2. Resolve Mengantar provider blockers only from canonical documentation or
   approved sandbox/live evidence.
3. Close the audit follow-ups that need no provider: A-282 (ViewContent
   ordering, browser trace), A-283 (windowed alert reason), A-284 (Google
   partial failures, requeue, purge), A-286 (UI gaps).
4. Implement **H9** only after the consent contract is accepted.

AD3, S1 and DOC1 closed earlier (§1) and are no longer in this order.

---

## 7. Completion Rules

An entry is complete only when its contract, implementation, executable proof, failure behaviour, and owning canonical document are updated together.

- A green build is not evidence a UI works; open it.
- A local build is not live-provider evidence.
- Runtime migration success on local D1 is not remote-D1 approval.
- A Custom Domain is not data isolation by itself.
- A deleted Worker does not authorize deleting its D1, KV, R2, DNS, or secrets.
- A documented prompt is not an executable adapter.

Local gates, in CI order:

```bash
npm run check
npm test
npm run build
```
