# Declared-stock disable matrix

When the seller-side reconcile decides "we cannot sell this listing right now"
(no internal keys + no buyer credit + nothing the pricing strategy will accept),
we have to push the right "stop selling" signal to each marketplace. The
five marketplaces use different APIs for this and they are NOT interchangeable.

This document is the canonical reference. **Do not** assume `declareStock(id, 0)`
"just works" everywhere — it doesn't.

## Per-marketplace reference

### Eneba

- **Disable signal:** GraphQL `S_updateAuction` with `declaredStock: null`.
- **Why:** "To disable the Declared Stock feature, send `declaredStock: null`. Setting it to `0` will not disable the feature."
- **Adapter behavior:** [`src/infra/marketplace/eneba/adapter.ts`](../src/infra/marketplace/eneba/adapter.ts) — `declareStock(externalListingId, 0)` already maps `quantity===0` to `S_updateAuction { declaredStock: null }` (lines 311–319).
- **Caller path for disable:** `adapter.declareStock(listing.external_listing_id, 0)`.

### Kinguin

- **Disable signal:** `PATCH /api/v1/offers/{id}` with `{ status: 'INACTIVE' }`.
- **Why:** Kinguin treats `declaredStock: 0` as a temporary "I have nothing right now" condition, not "stop selling". The offer remains `ACTIVE` and customers can still see it; reservations may even continue to come in. Marking the status `INACTIVE` is the correct disable.
- **Adapter behavior:** [`src/infra/marketplace/kinguin/adapter.ts`](../src/infra/marketplace/kinguin/adapter.ts) — `declareStock` PATCHes `declaredStock: 0` ONLY (lines 154–160) and does NOT change `status`. `deactivateListing` PATCHes `status: 'INACTIVE'` (lines 128–137).
- **Caller path for disable:** `adapter.deactivateListing(listing.external_listing_id)`.
- **Re-enable:** Call `declareStock(id, qty)` later — Kinguin's stock-update PATCH does NOT toggle status back to ACTIVE on its own. `updateListing` with a positive quantity also does not flip status. To re-enable, the auto-pricing / reconcile path must explicitly transition the listing back via `updateListing` or the listing-level "publish/restore" flow.

### G2A

- **Disable signal:** `PATCH /v3/sales/offers/{id}` with `variant: { inventory: { size: 0 }, active: false }`.
- **Adapter behavior:** [`src/infra/marketplace/g2a/adapter.ts`](../src/infra/marketplace/g2a/adapter.ts) — `declareStock` delegates to `syncStockLevel` (231–240), which sets `inventory.size: 0` and `active: false` when `clampedQty <= 0` (259–303). G2A's reservation flow also stops accepting new reservations when `active: false`.
- **Caller path for disable:** `adapter.declareStock(listing.external_listing_id, 0)` — already correct.

### Gamivo

- **Disable signal:** PUT `/api/public/v1/offers/{id}` with `status: GAMIVO_OFFER_STATUS_INACTIVE` (0) and `keys: 0`.
- **Adapter behavior:** [`src/infra/marketplace/gamivo/adapter.ts`](../src/infra/marketplace/gamivo/adapter.ts) — `declareStock(id, 0)` GETs the offer, sets `status: INACTIVE` and `keys: 0`, PUTs (145–163). Separate `deactivateListing` calls a dedicated `change-status` endpoint with the same effect (120–127).
- **Caller path for disable:** `adapter.declareStock(listing.external_listing_id, 0)` — already correct.

### Digiseller

- **Disable signal:** `sales_limit: 0` via `updateSalesLimit` AND `setProductStatus('disabled')` (`POST /api/product/edit/V2/status`).
- **Adapter behavior:** [`src/infra/marketplace/digiseller/adapter.ts`](../src/infra/marketplace/digiseller/adapter.ts) — `declareStock` for `quantity===0` calls both `updateSalesLimit(productId, 0)` AND `setProductStatus(productId, 'disabled')` (235–252).
- **Caller path for disable:** `adapter.declareStock(listing.external_listing_id, 0)` — already correct.

## Caller dispatch table

| Provider | "Disable" call from `dispatchDisable` |
|----------|---------------------------------------|
| Eneba | `adapter.declareStock(id, 0)` (already maps to `declaredStock: null`) |
| Kinguin | **`adapter.deactivateListing(id)`** (NOT `declareStock(id, 0)`) |
| G2A | `adapter.declareStock(id, 0)` (already maps to inventory=0 + active=false) |
| Gamivo | `adapter.declareStock(id, 0)` (already maps to status=INACTIVE + keys=0) |
| Digiseller | `adapter.declareStock(id, 0)` (already maps to sales_limit=0 + status=disabled) |

This is the only correct mapping. The Kinguin row is the entire reason this
document exists. If you add a new marketplace, you MUST update this table and
the dispatcher in [`src/infra/seller/dispatch-listing-disable.ts`](../src/infra/seller/dispatch-listing-disable.ts).

## When the dispatch fires

`dispatchDisable` is called by the credit-aware declared-stock reconcile
([`src/infra/seller/procurement-declared-stock-reconcile.service.ts`](../src/infra/seller/procurement-declared-stock-reconcile.service.ts))
and by the every-5-min stock-sync cron
([`src/infra/seller/pricing/seller-stock-sync.service.ts`](../src/infra/seller/pricing/seller-stock-sync.service.ts))
exactly when the new `CreditAwareDeclaredStockSelector` returns
`{ kind: 'disable', reason }`. The three reasons today:

- **`no_offer`** — no buyer-capable `provider_variant_offers` row for this variant.
- **`no_credit`** — buyer-capable rows exist, but every candidate buyer's wallet preflight fails (no row for the offer currency, insufficient funds, currency mismatch).
- **`uneconomic`** — buyer-capable rows exist with credit, but no candidate's USD-normalized cost respects the listing's pricing-strategy / margin floor.

## What we do NOT do

- We do NOT mark `seller_listings.status = 'paused'` in our DB. The DB row stays
  `active` so the next reconcile cycle (typically 5 min) re-evaluates and
  auto-recovers the moment a buyer wallet refills. Admin does not have to
  manually unpause anything.
- We do NOT call `adapter.deactivateListing` on Eneba/G2A/Gamivo/Digiseller.
  Their `declareStock(id, 0)` already encodes the right "no sale" semantics.
  Calling `deactivateListing` on Eneba would unpublish the auction outright,
  which is a separate, irreversible-ish action.
- We do NOT cap-and-clamp the disable signal. `declaredStock: null` on Eneba
  is intentionally distinct from `declaredStock: 0`.
