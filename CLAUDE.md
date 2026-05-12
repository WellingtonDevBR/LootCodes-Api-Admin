# Backend Admin Development Guidelines

Admin-only Fastify API server. Hexagonal architecture with SOLID principles. Every route requires admin or employee authentication — there are **zero public or guest endpoints**. Designed to be vendor-agnostic: Supabase is an infrastructure adapter, not a core dependency.

## Quick Reference

- **Runtime**: Node.js 22 LTS with TypeScript
- **Framework**: Fastify 5
- **DI**: tsyringe (constructor injection via decorators)
- **Testing**: Vitest
- **Logging**: pino (Fastify built-in) + `shared/logger.ts`
- **Validation**: zod (env config) + Fastify JSON schemas (requests)
- **Error tracking**: Sentry (`@sentry/node` + `@sentry/profiling-node`)
- **Security headers**: `@fastify/helmet`
- **Rate limiting**: `@fastify/rate-limit` (100 req/min global)
- **File uploads**: `@fastify/multipart` (10 MB limit)
- **Package manager**: npm
- **Container port**: 3000 (default `PORT`; host maps `3000:3000` on EC2)

## Architecture Layers

```
core/          Domain logic — ZERO external dependencies
  ports/       Interface definitions (contracts for repositories, role checks, auth)
  errors/      Domain error classes

infra/         Adapter implementations — external SDKs live here
  database/    Supabase DB adapter (implements IDatabase)
  auth/        Supabase Auth adapter (IAuthProvider), role checker (IAdminRoleChecker), IP blocklist (IIpBlocklist)

http/          Transport — Fastify routes, middleware
  routes/      Route definitions grouped by admin domain (22 route files)
  middleware/  Auth guards, IP blocklist hook, error handler

shared/        Pure utility modules (no external deps)
config/        Environment loading (zod-validated), CORS config
di/            Composition root — wires ports to adapters
```

### Dependency Rules

- `core/` imports ONLY from `core/`, `shared/`, and `tsyringe` (DI decorators: `@injectable`, `@inject`). Never from `infra/`, `http/`, or `config/`.
- `infra/` imports from `core/ports/` (to implement), `core/errors/` (to throw domain errors), `config/` (for env), and `shared/`.
- `http/` imports from `core/ports/` (for interface types), `core/errors/`, `shared/`, `di/`, and Fastify types.
- `di/` imports everything (it is the composition root).
- `shared/` imports nothing except Node.js built-ins.

## Use Case Pattern

Route handlers resolve use cases (or ports directly) from the DI container. Every business operation follows:

1. Route receives request → auth guard validates admin/employee token
2. Route resolves use case or port from container
3. Use case/port executes business logic
4. Route formats and returns response

```typescript
// Route handler pattern
import { container } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IAdminOrderRepository } from '../../core/ports/...';

app.get('/orders', { preHandler: [employeeGuard] }, async (request, reply) => {
  const repo = container.resolve<IAdminOrderRepository>(TOKENS.AdminOrderRepository);
  const result = await repo.listOrders(params);
  return reply.send(result);
});
```

## Security

### All Routes Require Auth

Every route file registers one of three guards as `preHandler`:

| Guard | Who | When |
|---|---|---|
| `adminGuard` | Full admin only | Destructive operations (refunds, deletions, security config) |
| `employeeGuard` | Admin OR employee | Read operations, standard management |
| `internalSecretGuard` | Service-to-service | Cron triggers, internal webhooks |

### Auth Guard Flow

1. Extract `Bearer` token from `Authorization` header
2. Validate token via `IAuthProvider.getUserByToken()`
3. Check role via `IAdminRoleChecker.isAdmin()` or `.isAdminOrEmployee()`
4. Attach `authUser` to request object
5. Reject with 401/403 if any step fails

### IP Blocklist

Global `onRequest` hook checks every incoming IP against the blocklist (via `IIpBlocklist`). Exempt: `/health` only.

### Internal Secret Guard

For machine-to-machine calls (cron, event dispatchers). Validates `X-Internal-Secret` header against `INTERNAL_SERVICE_SECRET` (+ rotatable `INTERNAL_SERVICE_SECRET_PREVIOUS`).

## Cron Surface

Seller-side maintenance (cost basis, pricing + marketplace push, declared-stock reconcile, remote-stock sync, reservation expiry) runs as a **single** orchestrated HTTP endpoint. The in-process `node-cron` registry is **intentionally empty** — `infra/scheduler/cron-registry.ts` exists only as a forward-compatible shell.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /internal/cron/reconcile-seller-listings` | `X-Internal-Secret` | Single trigger surface for all seller maintenance phases |

### Phases (executed in order)

1. `expire-reservations` — release stale `seller_stock_reservations`
2. `sync-buyer-catalog` — fetch live quotes from Bamboo/AppRoute, refresh `provider_variant_offers` **before** cost-basis reads it
3. `cost-basis` — refresh `seller_listings.cost_basis_cents` using up-to-date buyer offer prices
4. `pricing` — recompute prices honouring manual overrides + `pricing_overrides` + per-listing strategy, then push via marketplace adapters
5. `declared-stock` — reconcile declared-stock target via `computeDeclaredStockTarget` and push to marketplaces
6. `remote-stock` — pull remote stock for `auto_sync_stock=true` listings
7. `eneba-key-reconcile` — cross-check internal key provisions against Eneba `S_keys` API: REPORTED keys → mark `faulty`; orphaned provisions (delivered on our side but not SOLD on Eneba) → restock key to `available`, cancel reservation

### Request body (strict — validated by Zod)

```json
{
  "variant_ids": ["uuid", "..."],
  "batch_limit": 500,
  "dry_run": false,
  "phases": ["cost-basis", "pricing"]
}
```

All fields optional. Bad input is rejected with `400 invalid_request_body` — no silent dropping:

- `variant_ids` — array of UUIDs, **min 1** when present. Filters the `declared-stock` phase only.
- `batch_limit` — positive integer. Forwarded to the `declared-stock` phase only.
- `dry_run` — boolean. Only affects `declared-stock`.
- `phases` — non-empty array of known phase names. Omitted ⇒ all five phases run. Explicit `[]` is a `400` (a no-op cron tick is never the intended call). Unknown names are a `400`.

The phases not directly filtered by `variant_ids` (`cost-basis`, `pricing`, `remote-stock`, `expire-reservations`) sweep all `auto_sync_*=true` listings — that is the existing service semantics.

### Pause control — `platform_settings.fulfillment_mode`

The orchestrator reads `platform_settings.fulfillment_mode`. The row is **mandatory** with one of three values; reading the row is strict — missing row, malformed JSON, or unknown mode all throw and the cron run aborts with a 500. There is no silent fallback.

- `auto` → run normally.
- `hold_new_cards` → run normally (this flag only gates the checkout path).
- `hold_all` → every phase short-circuits with `skipped_reason: 'global_hold'`. The cron remains reachable; toggling back to `auto` resumes work on the next tick.

### Per-phase failure isolation

A phase that throws is logged via `logger.error` (forwarded to Sentry) and recorded in `result.phases[phase].error`; later phases still run. This is **reporting**, not masking — every failure is surfaced both in logs and in the response body.

### External scheduler

Any external scheduler can drive the route — no in-process timer is required. Recommended cadence: every 5 minutes. Examples:
- Supabase `pg_cron` + `net.http_post` with `X-Internal-Secret`.
- GCP Cloud Scheduler / AWS EventBridge → HTTPS POST.

## Port Registry

### Infrastructure Ports (TOKENS)

| Token | Port Interface | Adapter | Purpose |
|---|---|---|---|
| `Database` | `IDatabase` | `SupabaseDbAdapter` | Generic table queries (infra-only) |
| `AuthProvider` | `IAuthProvider` | `SupabaseAuthAdapter` | Token validation |
| `AdminRoleChecker` | `IAdminRoleChecker` | `SupabaseAdminRoleAdapter` | Admin/employee role checks |
| `IpBlocklist` | `IIpBlocklist` | `SupabaseIpBlocklistAdapter` | IP block checks |

### Domain Repositories (TOKENS)

| Token | Purpose |
|---|---|
| `AdminOrderRepository` | Orders, fulfillment, refunds |
| `AdminInventoryRepository` | Keys, stock, encryption |
| `AdminInventorySourceRepository` | Variant-to-source linking |
| `AdminUserRepository` | User lookup, profiles, sessions |
| `AdminSecurityRepository` | Security configs, rate limits |
| `AdminPromoRepository` | Promo code CRUD, approval |
| `AdminSupportRepository` | Tickets, status management |
| `AdminCurrencyRepository` | Currency rates, sync |
| `AdminProcurementRepository` | Provider quotes, catalog, purchases |
| `AdminPriceMatchRepository` | Price match requests |
| `AdminReferralRepository` | Referral management, disputes |
| `AdminReviewRepository` | Review claims |
| `AdminAnalyticsRepository` | Dashboard metrics, financial data |
| `AdminNotificationRepository` | Broadcasts, unseen counts |
| `AdminAlgoliaRepository` | Index stats |
| `AdminSettingsRepository` | Platform settings |
| `AdminApprovalRepository` | Action approval workflow |
| `AdminAuditRepository` | Audit log |
| `AdminVerificationRepository` | ID verification approvals |
| `AdminAuthSmsRepository` | Admin SMS 2FA |
| `AdminDigisellerRepository` | Digiseller reconciliation |
| `AdminPricingRepository` | Variant price timeline |
| `PlatformSettingsRepository` | Read-only access to `platform_settings.fulfillment_mode` (consumed by `ReconcileSellerListingsUseCase`) |

### Use Case Tokens (UC_TOKENS)

77 use cases across 16 domains. Key groups:

| Domain | Use Cases |
|---|---|
| Orders & Fulfillment | FulfillVerifiedOrder, ManualFulfill, RecoverOrder, ConfirmPayment, ProcessPreorder, GenerateGuestAccessLink, RefundOrder, RefundTicket, RefundInitiate, ListOrders, GetOrderDetail, ReissueEmail |
| Inventory & Keys | EmitInventoryStockChanged, SendStockNotificationsNow, ReplaceKey, FixKeyStates, UpdateAffectedKey, DecryptKeys, RecryptProductKeys, SetKeysSalesBlocked, SetVariantSalesBlocked, MarkKeysFaulty, LinkReplacementKey, ManualSell, UpdateVariantPrice |
| Inventory Sources | LinkVariantInventorySource, UnlinkVariantInventorySource, ListVariantInventorySources, ListLinkableInventorySources |
| Users | GetComprehensiveUserData, GetUserTimeline, GetUserSessions, SearchAccountProfiles, ToggleUserRole, DeleteUserAccount, BlockCustomer, ForceLogout |
| Security & Fraud | GetSecurityConfigs, UpdateSecurityConfig, UnlockRateLimit, DirectUnlockRateLimit |
| Promo Codes | CreatePromoCode, UpdatePromoCode, TogglePromoActive, DeletePromoCode, SubmitPromoApproval, ApprovePromoCode, RejectPromoCode, SendPromoNotifications, EstimatePromoReach, ListPromoCodes, GetPromoUsageStats |
| Support | UpdateTicketStatus |
| Currency | SyncCurrency, UpdateCurrencyManual, GetCurrencyRates |
| Procurement | TestProviderQuote, SearchProviders, ManageProviderOffer, IngestProviderCatalog, IngestProviderCatalogStatus, RefreshProviderPrices, ManualProviderPurchase, RecoverProviderOrder |
| Price Match | ApprovePriceMatch, RejectPriceMatch, PreviewPriceMatchDiscount |
| Referrals | ListReferrals, ListReferralLeaderboard, ResolveReferralDispute, InvalidateReferral, PayLeaderboardPrizes |
| Reviews | ListTrustpilotReviewClaims, ResolveTrustpilotReviewClaim |
| Analytics | GetDashboardMetrics, GetFinancialSummary, GetTransactions |
| Notifications | SendBroadcastNotification, GetAdminUnseenCounts, MarkAdminSectionSeen |
| Settings & Algolia | GetAlgoliaIndexStats, ListSettings, UpdateSetting |
| Approval Workflow | RequestAction, ApproveAction, RejectAction, ListActionRequests |
| Audit | ListAuditLog |
| Verification | ApproveVerification, DenyVerification |
| Admin Auth/SMS | SendAdminSms, VerifyAdminSms, SendSecurityAlertSms |
| Digiseller | DigisellerReconcileProfit |
| Pricing | GetVariantPriceTimeline |

## Domain Module Map (22 Route Groups)

| Route prefix | File | Domains covered |
|---|---|---|
| `/health` | `health.routes.ts` | Health check (unauthenticated) |
| `/api/admin/orders` | `orders.routes.ts` | Order list, detail, fulfill, refund, recover, reissue email |
| `/api/admin/inventory` | `inventory.routes.ts` | Keys, stock, encryption, sales blocking |
| `/api/admin/inventory-sources` | `inventory-sources.routes.ts` | Variant-source linking |
| `/api/admin/users` | `users.routes.ts` | User data, timeline, sessions, roles, blocking |
| `/api/admin/security` | `security.routes.ts` | Config CRUD, rate limit unlock |
| `/api/admin/promo` | `promo.routes.ts` | Promo CRUD, approval flow, notifications |
| `/api/admin/support` | `support.routes.ts` | Ticket status updates |
| `/api/admin/currency` | `currency.routes.ts` | Rate sync, manual updates |
| `/api/admin/procurement` | `procurement.routes.ts` | Provider quotes, catalog, purchases |
| `/api/admin/price-match` | `price-match.routes.ts` | Approve/reject/preview |
| `/api/admin/referrals` | `referrals.routes.ts` | List, leaderboard, disputes |
| `/api/admin/reviews` | `reviews.routes.ts` | Trustpilot claims |
| `/api/admin/analytics` | `analytics.routes.ts` | Dashboard, financials, transactions |
| `/api/admin/notifications` | `notifications.routes.ts` | Broadcast, unseen counts |
| `/api/admin/algolia` | `algolia.routes.ts` | Index stats |
| `/api/admin/settings` | `settings.routes.ts` | Platform settings CRUD |
| `/api/admin/approvals` | `approvals.routes.ts` | Action request workflow |
| `/api/admin/audit` | `audit.routes.ts` | Audit log queries |
| `/api/admin/verification` | `verification.routes.ts` | ID verification decisions |
| `/api/admin/auth` | `admin-auth.routes.ts` | SMS 2FA, security alerts |
| `/api/admin/digiseller` | `digiseller.routes.ts` | Profit reconciliation |
| `/api/admin/pricing` | `pricing.routes.ts` | Variant price timelines |

## How to Add a New Domain

1. **Port**: Create `core/ports/{domain}-repository.port.ts` with interface methods.
2. **Token**: Add `Admin{Domain}Repository` to `TOKENS` in `di/tokens.ts`.
3. **Adapter**: Create `infra/{domain}/supabase-admin-{domain}.adapter.ts` implementing the port.
4. **Wire DI**: Register in `di/container.ts`.
5. **Use cases** (optional): Create `UC_TOKENS` entries + use-case classes if business logic exists beyond simple CRUD.
6. **Routes**: Create `http/routes/{domain}.routes.ts`. Register as Fastify plugin in `app.ts` with prefix `/api/admin/{domain}`.
7. **Guard**: Apply `adminGuard` or `employeeGuard` as `preHandler` on every route.

## Porting from Edge Functions

When migrating admin operations from the `admin-operations` Edge Function:

1. Replace `Deno.env.get(...)` with config from `config/env.ts`.
2. Replace Deno HTTP types with Fastify request/reply.
3. Replace `getServiceRoleClient()` with domain-specific port interfaces. The adapter uses `IDatabase` internally.
4. Replace action routing (`switch (action)`) with dedicated route handlers.
5. Replace `new Response(JSON.stringify(...))` with `reply.code(xxx).send(data)`.
6. Auth: The Edge Function checked JWT + role inline; here, auth guards handle it automatically.
7. Keep the same business logic — port, don't rewrite.

## Environment Variables

All env vars validated at startup in `config/env.ts`. App crashes on missing required vars.

**Required:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- `INTERNAL_SERVICE_SECRET`
- `CORS_ORIGINS`

**Optional:**
- `INTERNAL_SERVICE_SECRET_PREVIOUS` — rotatable secret (both accepted during rotation)
- `STRIPE_SECRET_KEY` — refunds, payment operations
- `ALGOLIA_APP_ID`, `ALGOLIA_ADMIN_KEY`, `ALGOLIA_INDEX_NAME` — search index management
- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` — error tracking
- `SITE_URL`, `SITE_NAME` — email templates, link generation

## Docker

- `Dockerfile` — multi-stage build (builder + minimal `node:22-alpine` runtime)
- `docker-compose.yml` — local dev
- `docker-compose.prod.yml` — production on EC2 (`3000:3000`; matches Terraform `api_port`)
- Final image: non-root `node` user, no `.env`, only dist + node_modules + package.json
- Health check: `GET /health/`

## Testing Patterns

**Unit tests** — mock ports, test use-case logic:
```typescript
import { container } from 'tsyringe';
const repo = { listOrders: vi.fn() };
container.register(TOKENS.AdminOrderRepository, { useValue: repo });

const uc = container.resolve<ListOrdersUseCase>(UC_TOKENS.ListOrders);
const result = await uc.execute(params);
```

**Integration tests** — use Fastify inject:
```typescript
const app = await buildApp();
const res = await app.inject({
  method: 'GET',
  url: '/api/admin/orders',
  headers: { authorization: `Bearer ${adminToken}` },
});
expect(res.statusCode).toBe(200);
```

## Conventions

- Prices: cents (integer). `2999` = $29.99.
- IDs: UUID v4. Validate with Fastify `format: 'uuid'`.
- Timestamps: ISO 8601 strings.
- Errors: domain errors mapped to HTTP by the global error handler.
- Logging: structured JSON via pino. Always include `requestId`.
- FORBIDDEN: `console.log` — use `createLogger` from `shared/logger.ts`.
- FORBIDDEN: `any` types — use `unknown` and narrow.
- FORBIDDEN: imports inside functions — all imports at file top.
- FORBIDDEN: public/guest endpoints — every route must have an auth guard.
- FORBIDDEN: `IDatabase` usage in route handlers — always go through domain repositories.
