# AdsBookCMS — Operations API contract

> Verified against disk: 2026-10-30 @ `645963a` + feat/a45-cli working tree

The operations API lets a store's own tooling — a script, a spreadsheet sync,
the `adsbook` CLI, an agent — read the store's orders. It is the server-to-server
twin of the storefront headless API in
[STOREFRONT_INTEGRATION.md](../STOREFRONT_INTEGRATION.md): same keys, same rate
limits, same audit trail, different scopes and a different base path.

This document owns the contract's rules. The machine-readable shape (every
parameter and field) is the OpenAPI 3.1 document the install serves at
`GET /api/ops/v1/openapi.json`, generated from `src/lib/ops-openapi.ts`.
`src/lib/ops-openapi.test.ts` fails when that document and the operations table
in `src/lib/ops-api.ts` disagree, or when the order serializer writes a field the
schema does not name. Requirements: PRD A45, REQ-251 to REQ-264.

## 1. Calling it

- Base path: `https://<store-domain>/api/ops/v1`.
- Auth: `Authorization: Bearer <key>` (or `X-App-Key: <key>`). Keys are
  issued in admin › Pengaturan › Headless API
  (`/admin/settings/developer`).
- **No CORS.** Responses carry no `Access-Control-*` header and the storefront
  origin allowlist is not consulted, so a browser on another origin can never
  read one. Call it from a server or a terminal; never put an ops key in
  browser code.
- Every response is `Cache-Control: no-store`: order payloads carry buyer data.
- Rate limit and daily quota are per key (defaults 120/min, 10,000/day) and
  reported in `X-RateLimit-*` and `X-DailyQuota-*` headers.

## 2. Scopes

| Scope | Grants | Status |
| --- | --- | --- |
| `ops:orders:read` | Order list, order detail, this contract | Live |
| `ops:orders:read_pii` | Adds buyer name, phone, email, street address, postal code, ad click-id values, VA number and who switched a payment | Live |
| `ops:orders:write` | Order actions | Reserved (v2, REQ-257) |
| `ops:shipping:write` | Shipping actions | Reserved (v2) |
| `ops:reports:read` | Reports | Reserved (REQ-258) |
| `ops:catalog:read` | Catalogue and landing page read | Reserved (A-441) |

- No `ops:` scope is ever a default. A key is created or changed only with an
  explicit scope list.
- Only the `owner` role issues, changes or revokes a key holding an `ops:`
  scope.
- A storefront scope never satisfies an operations route, and an `ops:` scope
  never satisfies a storefront route. A key may hold both sets.
- `ops:orders:read_pii` is additive: without it the same routes answer with the
  buyer fields omitted, not refused.

## 3. Operations

| Method | Path | Scope |
| --- | --- | --- |
| `GET` | `/orders` | `ops:orders:read` |
| `GET` | `/orders/{number}` | `ops:orders:read` |
| `GET` | `/openapi.json` | `ops:orders:read` |

### Listing orders

Two modes, chosen by `updated_since`:

- **Browse** (no `updated_since`): newest first by creation time.
- **Sync** (`updated_since=<ISO-8601>`): oldest change first by `updated_at`.
  Store the last `updated_at` you received and ask again from it. Every write
  to an order advances `updated_at` (a database trigger, migration `0075`), so
  status changes, payment switches, resi updates and admin edits all surface.

Pages hold up to 100 orders (default 50). `next_cursor` is opaque, bound to
the mode it was issued in, and `null` on the last page. Filters: `kind`
(`order`, `lead` = abandoned checkout, `all`), `status`, `payment_method`,
`payment_status`, `date_filter` (+ `date_start`/`date_end` for `custom`, the
admin's Jakarta-day rule), `source_slug`, `utm_campaign`.

### Order fields

Amounts are whole rupiah. `void: true` marks an order released from the books.
Attribution carries `source_slug`, the resolved `traffic_source` and the five
UTM tags as captured; it never carries click-id values without
`ops:orders:read_pii`. The detail adds `items` (with the weight recorded at
order time) and the latest payment instruction.

## 4. Errors

```json
{ "success": false, "error": { "message": "…", "code": "FILTER_INVALID" } }
```

| Status | Meaning |
| --- | --- |
| 400 | Invalid filter, limit or cursor |
| 401 | Key missing, invalid or revoked |
| 403 | Key lacks the operation's scope (`API_SCOPE_FORBIDDEN`) |
| 404 | No order has this number |
| 422 | Invalid custom date range |
| 429 | Rate limit or daily quota exhausted |
| 503 | Key store or usage policy unavailable |

Every call made with a recognised key, allowed or refused, is written to the
key's audit trail as `ops.<operation>`.

## 5. The `adsbook` CLI

A client of this API only, in `scripts/adsbook.ts` (logic in
`src/lib/adsbook-cli.ts`), no dependency beyond Node. Run it from a checkout
with `npm run -s adsbook -- <command>`; `-s` keeps npm's banner out of stdout
so `--json` output pipes cleanly.

```bash
npm run -s adsbook -- login --url https://toko.example   # asks for the key, hidden
npm run -s adsbook -- orders list --status pending
npm run -s adsbook -- orders list --updated-since 2026-10-30T00:00:00Z --json
npm run -s adsbook -- orders show INV-10023
npm run -s adsbook -- logout
```

- `login` checks the key against `/openapi.json` before storing it, so a key
  without `ops:orders:read` is refused, not saved. It reads the key from
  stdin when piped, otherwise prompts without echo; `--key` exists for
  scripts but leaves the key in shell history.
- Credentials live in `~/.config/adsbook/credentials.json`, mode 0600 (the
  directory 0700). `logout` deletes the file. The key never appears in the
  CLI's output or errors.
- `--json` prints exactly the API's `data`; for a list, the next page's
  cursor goes to stderr. Human output shows times in WIB.
- Every `orders list` filter in §3 is a flag: `--status`, `--payment-method`,
  `--date-filter`, `--updated-since`, `--cursor`, and so on.
- Store URLs must be `https://`, except `http://localhost`.

## 6. Changing the contract

Add the route under `src/pages/api/ops/v1`, register it in `OPS_OPERATIONS`
with one minimum scope, describe it in `src/lib/ops-openapi.ts`, and update
§3 here (and §5 when the CLI gains a command). The tests refuse a route
missing from the table and a table entry missing from the document. A
breaking change to a field or parameter needs a new version path, not an
edit to `v1`.
