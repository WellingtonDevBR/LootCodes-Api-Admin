# Seller Webhook & Pricing Migration — Testing Guide

## Prerequisites

1. **Backend running**: `npm run dev` in `LootCodes-Api-Admin/`
2. **Supabase linked**: `supabase db push` to apply the `restock_seller_key` RPC migration
3. **Environment variables**:
   - `ENABLE_CRON=true` (or `NODE_ENV=production`) to activate scheduled jobs
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` set
4. **At least one `provider_accounts` row** with `supports_seller=true` and a valid `seller_config` JSONB

---

## 1. Webhook Endpoints

### 1.1 Eneba Declared Stock — RESERVE

```bash
curl -X POST http://localhost:3001/webhooks/eneba/declared-stock \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <callback_auth_token>" \
  -d '{
    "action": "RESERVE",
    "reservationId": "<ext-reservation-id>",
    "productId": "<external-product-id>",
    "quantity": 1,
    "auctionId": "<external-listing-id>"
  }'
```

**Expected**: 200 with `{ "success": true, "keysReserved": 1 }`. Check `seller_stock_reservations` for a new row. Check `product_keys` — one key should have `key_state = 'seller_reserved'`.

### 1.2 Eneba Declared Stock — PROVIDE

```bash
curl -X POST http://localhost:3001/webhooks/eneba/declared-stock \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <callback_auth_token>" \
  -d '{
    "action": "PROVIDE",
    "reservationId": "<ext-reservation-id>"
  }'
```

**Expected**: 200 with `{ "success": true, "keysProvisioned": 1 }`. Check `seller_key_provisions` for a new row with `status = 'delivered'`. The product key should now be `key_state = 'seller_provisioned'`.

### 1.3 Eneba Declared Stock — CANCEL

```bash
curl -X POST http://localhost:3001/webhooks/eneba/declared-stock \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <callback_auth_token>" \
  -d '{
    "action": "CANCEL",
    "reservationId": "<ext-reservation-id>",
    "reason": "buyer_cancelled"
  }'
```

**Expected**: 200 with `{ "success": true, "keysReleased": 1 }`. Key should return to `key_state = 'available'`.

### 1.4 Generic Marketplace Order (Key Upload model)

```bash
curl -X POST http://localhost:3001/webhooks/gamivo/order \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth_token>" \
  -d '{
    "orderId": "ext-order-123",
    "productId": "ext-product-id",
    "quantity": 1,
    "listingId": "ext-listing-id"
  }'
```

### 1.5 Marketplace Refund

```bash
curl -X POST http://localhost:3001/webhooks/eneba/refund \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <callback_auth_token>" \
  -d '{
    "reservationId": "<ext-reservation-id>",
    "reason": "buyer_refund"
  }'
```

**Expected**: Keys are restocked via `restock_seller_key` RPC. Domain event `seller.stock_cancelled` emitted.

---

## 2. Seller Pricing Endpoints

### 2.1 Calculate Payout (adapter-driven)

```bash
curl -X POST http://localhost:3001/seller-pricing/payout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_jwt>" \
  -d '{
    "listing_id": "<seller-listing-uuid>",
    "price_cents": 2999
  }'
```

**Expected**: Returns `payout` object with `gross_price_cents`, `marketplace_fee_cents`, `net_payout_cents`, `profit_cents`. Fee calculation now goes through marketplace adapter (not just a flat percentage).

### 2.2 Get Competitors (live fetch)

```bash
curl http://localhost:3001/seller-pricing/competitors/<listing-id> \
  -H "Authorization: Bearer <admin_jwt>"
```

**Expected**: Returns competitor list. If marketplace adapter is configured, fetches live data. Falls back to stored `seller_competitor_snapshots` on error.

### 2.3 Suggest Price (strategy-aware)

```bash
curl -X POST http://localhost:3001/seller-pricing/suggest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_jwt>" \
  -d '{
    "listing_id": "<listing-id>",
    "effective_cost_cents": 1500,
    "listing_type": "declared_stock"
  }'
```

**Expected**: Returns strategy-driven suggestion with `suggested_price_cents`, `strategy` name, `estimated_payout_cents`.

### 2.4 Dry-Run Pricing (intelligence-enhanced)

```bash
curl -X POST http://localhost:3001/seller-pricing/dry-run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_jwt>" \
  -d '{ "listing_id": "<listing-id>" }'
```

**Expected**: Returns `dry_run` object including `oscillation_detected`, `is_dampened`, `worth_it`, `skip_reason`. Now uses real dampening/oscillation detection from the intelligence service.

### 2.5 Decision History

```bash
curl "http://localhost:3001/seller-pricing/decisions/<listing-id>?limit=10&offset=0" \
  -H "Authorization: Bearer <admin_jwt>"
```

### 2.6 Provider Defaults

```bash
curl http://localhost:3001/seller-pricing/provider-defaults/<account-id> \
  -H "Authorization: Bearer <admin_jwt>"
```

---

## 3. Manual Trigger Endpoints (Admin Only)

### 3.1 Refresh All Prices

```bash
curl -X POST http://localhost:3001/seller-pricing/refresh-prices \
  -H "Authorization: Bearer <admin_jwt>"
```

**Expected**: Processes all listings with `auto_sync_price=true`. Returns `listingsProcessed`, `pricesUpdated`, `pricesSkippedRateLimit`, `decisionsRecorded`.

### 3.2 Refresh All Cost Bases

```bash
curl -X POST http://localhost:3001/seller-pricing/refresh-cost-bases \
  -H "Authorization: Bearer <admin_jwt>"
```

**Expected**: Recomputes `cost_basis_cents` for all active listings using median key cost RPC.

### 3.3 Refresh All Stock

```bash
curl -X POST http://localhost:3001/seller-pricing/refresh-stock \
  -H "Authorization: Bearer <admin_jwt>"
```

**Expected**: Syncs available key counts to marketplace for listings with `auto_sync_stock=true`.

### 3.4 Cron Status

```bash
curl http://localhost:3001/seller-pricing/cron-status \
  -H "Authorization: Bearer <admin_jwt>"
```

**Expected**: Returns list of registered cron jobs with their schedules.

---

## 4. Cron Jobs (Automated)

When `ENABLE_CRON=true` or `NODE_ENV=production`:

| Job Name | Schedule | What It Does |
|---|---|---|
| `refresh-seller-prices` | Every 5 min (`*/5 * * * *`) | Fetches competitors, applies strategy, batch-updates prices |
| `refresh-seller-cost-bases` | Offset 2 min (`2 */5 * * * *`) | Recomputes median key cost from DB |
| `refresh-seller-stock` | Offset 2 min (`2 */5 * * * *`) | Syncs available stock to marketplaces |

**Verification**: Check backend logs for `[cron-scheduler] Starting auto-pricing refresh` messages. After 5 minutes, verify `seller_pricing_decisions` table has new rows.

---

## 5. Database Verification Queries

### Check Pricing Decisions Were Recorded

```sql
SELECT id, seller_listing_id, action, reason_code, price_before_cents,
       target_price_cents, decided_at
FROM seller_pricing_decisions
ORDER BY decided_at DESC
LIMIT 10;
```

### Check Competitor Snapshots

```sql
SELECT seller_listing_id, merchant_name, price_cents, is_own_offer, recorded_at
FROM seller_competitor_snapshots
ORDER BY recorded_at DESC
LIMIT 20;
```

### Check Competitor Floors

```sql
SELECT seller_listing_id, lowest_competitor_cents, second_lowest_cents,
       competitor_count, our_current_position, updated_at
FROM seller_competitor_floors
ORDER BY updated_at DESC
LIMIT 10;
```

### Verify Restock RPC Works

```sql
-- Test with a known seller-reserved key
SELECT * FROM restock_seller_key(
  '<key-uuid>'::uuid,
  ARRAY['seller_reserved', 'seller_provisioned', 'seller_uploaded']
);
```

---

## 6. Architecture Compliance Checklist

- [ ] No direct Supabase client usage in use cases — all go through `IDatabase` port
- [ ] Pricing use cases inject `ISellerPricingService` (not `IAdminSellerPricingRepository` for fee calculation)
- [ ] `DryRunPricingUseCase` uses intelligence service for dampening/oscillation (not inline logic)
- [ ] Cron jobs resolve services from DI container (no `new` keyword)
- [ ] All new services are `@injectable()` with `@inject(TOKENS.*)` constructors
- [ ] No `console.log` — all logging via `createLogger()`
- [ ] `SellerStockSyncService` uses `ISellerStockSyncService` port interface
- [ ] `cron-registry.ts` imports port types (not concrete classes) for resolution
- [ ] Manual trigger endpoints use `adminGuard` middleware
- [ ] Migration has `REVOKE ALL ... FROM anon, public` + explicit `GRANT`

---

## 7. Known Limitations

1. **Marketplace adapters** must be implemented per provider (Eneba, G2A, Gamivo, Kinguin). The registry returns `null` for unconfigured providers — services handle this gracefully.
2. **Live competitor fetching** depends on marketplace API availability. Fallback to stored snapshots is automatic.
3. **Cost basis** returns 0 if no keys exist for a variant (no error, just zero).
4. **Stock sync** skips listings without `external_listing_id` (not yet published to marketplace).
