import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { ListPriceMatchClaimsUseCase } from '../../core/use-cases/price-match/list-price-match-claims.use-case.js';
import type { GetPriceMatchClaimDetailUseCase } from '../../core/use-cases/price-match/get-price-match-claim-detail.use-case.js';
import type { GetPriceMatchClaimConfidenceUseCase } from '../../core/use-cases/price-match/get-price-match-claim-confidence.use-case.js';
import type { GetPriceMatchScreenshotUseCase } from '../../core/use-cases/price-match/get-price-match-screenshot.use-case.js';
import type { ApprovePriceMatchUseCase } from '../../core/use-cases/price-match/approve-price-match.use-case.js';
import type { RejectPriceMatchUseCase } from '../../core/use-cases/price-match/reject-price-match.use-case.js';
import type { PreviewPriceMatchDiscountUseCase } from '../../core/use-cases/price-match/preview-price-match-discount.use-case.js';
import type { ListPriceMatchRetailersUseCase } from '../../core/use-cases/price-match/list-price-match-retailers.use-case.js';
import type { CreatePriceMatchRetailerUseCase } from '../../core/use-cases/price-match/create-price-match-retailer.use-case.js';
import type { UpdatePriceMatchRetailerUseCase } from '../../core/use-cases/price-match/update-price-match-retailer.use-case.js';
import type { ListPriceMatchBlockedDomainsUseCase } from '../../core/use-cases/price-match/list-price-match-blocked-domains.use-case.js';
import type { CreatePriceMatchBlockedDomainUseCase } from '../../core/use-cases/price-match/create-price-match-blocked-domain.use-case.js';
import type { UpdatePriceMatchBlockedDomainUseCase } from '../../core/use-cases/price-match/update-price-match-blocked-domain.use-case.js';
import type { GetPriceMatchConfigUseCase } from '../../core/use-cases/price-match/get-price-match-config.use-case.js';
import type { UpdatePriceMatchConfigUseCase } from '../../core/use-cases/price-match/update-price-match-config.use-case.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'expired', 'cancelled']);
const VALID_DISCOUNT_TYPES = new Set(['percentage', 'fixed_amount']);
const VALID_REJECTION_REASONS = new Set([
  'product_not_identical', 'product_out_of_stock', 'different_region',
  'retailer_not_approved', 'marketplace_seller', 'price_not_verified',
  'member_only_pricing', 'coupon_pricing', 'bundle_pricing',
  'clearance_pricing', 'advertising_error', 'insufficient_evidence', 'other',
]);
const VALID_RETAILER_CATEGORIES = new Set(['official', 'authorized', 'marketplace', 'grey_market']);
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const ISO_CURRENCY_RE = /^[A-Z]{3}$/;

function getAuthUser(request: unknown): { id: string } {
  return (request as Record<string, unknown>).authUser as { id: string };
}

export async function adminPriceMatchRoutes(app: FastifyInstance) {
  // ── Claims ─────────────────────────────────────────────────────────────

  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/',
    { preHandler: [employeeGuard] },
    async (request, reply) => {
      const q = request.query;
      const status = q.status && VALID_STATUSES.has(q.status) ? q.status : undefined;
      const user_id = q.user_id && UUID_RE.test(q.user_id) ? q.user_id : undefined;
      const guest_email = q.guest_email?.trim().slice(0, 320) || undefined;
      const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10), 1), 100) : undefined;
      const offset = q.offset ? Math.max(parseInt(q.offset, 10), 0) : undefined;

      const uc = container.resolve<ListPriceMatchClaimsUseCase>(UC_TOKENS.ListPriceMatchClaims);
      const result = await uc.execute({ status, user_id, guest_email, limit, offset });
      return reply.send(result);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [employeeGuard] },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid claim_id' });

      const uc = container.resolve<GetPriceMatchClaimDetailUseCase>(UC_TOKENS.GetPriceMatchClaimDetail);
      const result = await uc.execute(id);
      if (!result) return reply.code(404).send({ error: 'Claim not found' });
      return reply.send(result);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id/confidence',
    { preHandler: [employeeGuard] },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid claim_id' });

      const uc = container.resolve<GetPriceMatchClaimConfidenceUseCase>(UC_TOKENS.GetPriceMatchClaimConfidence);
      const result = await uc.execute(id);
      if (!result) return reply.code(404).send({ error: 'Claim not found' });
      return reply.send(result);
    },
  );

  app.post<{ Body: { screenshot_path: string } }>(
    '/screenshot-url',
    { preHandler: [employeeGuard] },
    async (request, reply) => {
      const { screenshot_path } = request.body;
      if (!screenshot_path || typeof screenshot_path !== 'string' || screenshot_path.length > 500) {
        return reply.code(400).send({ error: 'Invalid screenshot_path' });
      }

      const uc = container.resolve<GetPriceMatchScreenshotUseCase>(UC_TOKENS.GetPriceMatchScreenshot);
      const result = await uc.execute(screenshot_path);
      return reply.send(result);
    },
  );

  // ── Approve / Reject ───────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { discount_type: string; discount_value: number; admin_notes?: string } }>(
    '/:id/approve',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid claim_id' });

      const { discount_type, discount_value, admin_notes } = request.body;

      if (!discount_type || !VALID_DISCOUNT_TYPES.has(discount_type)) {
        return reply.code(400).send({ error: 'Invalid discount_type' });
      }
      if (typeof discount_value !== 'number' || !Number.isFinite(discount_value) || discount_value <= 0) {
        return reply.code(400).send({ error: 'Invalid discount_value' });
      }

      const authUser = getAuthUser(request);
      const uc = container.resolve<ApprovePriceMatchUseCase>(UC_TOKENS.ApprovePriceMatch);
      const result = await uc.execute({
        claim_id: id,
        admin_id: authUser.id,
        discount_type: discount_type as 'percentage' | 'fixed_amount',
        discount_value,
        admin_notes: admin_notes?.trim().slice(0, 500) || undefined,
      });

      if (!result.success) {
        const code = result.error?.includes('not found') ? 404
          : result.error?.includes('already') ? 409
          : result.error?.includes('below procurement') ? 422
          : 400;
        return reply.code(code).send({ error: result.error });
      }
      return reply.send(result);
    },
  );

  app.post<{ Params: { id: string }; Body: { rejection_reason: string; admin_notes?: string } }>(
    '/:id/reject',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid claim_id' });

      const { rejection_reason, admin_notes } = request.body;

      if (!rejection_reason || !VALID_REJECTION_REASONS.has(rejection_reason)) {
        return reply.code(400).send({ error: 'Invalid rejection_reason' });
      }

      const authUser = getAuthUser(request);
      const uc = container.resolve<RejectPriceMatchUseCase>(UC_TOKENS.RejectPriceMatch);
      const result = await uc.execute({
        claim_id: id,
        admin_id: authUser.id,
        rejection_reason,
        admin_notes: admin_notes?.trim().slice(0, 500) || undefined,
      });

      if (!result.success) {
        const code = result.error?.includes('not found') ? 404 : result.error?.includes('already') ? 409 : 400;
        return reply.code(code).send({ error: result.error });
      }
      return reply.send(result);
    },
  );

  app.post<{ Body: { currency: string; discount_minor?: number; usd_cents?: number } }>(
    '/preview-discount',
    { preHandler: [employeeGuard] },
    async (request, reply) => {
      const { currency, discount_minor, usd_cents } = request.body;

      if (!currency || !ISO_CURRENCY_RE.test(currency.trim().toUpperCase())) {
        return reply.code(400).send({ error: 'Invalid currency' });
      }

      const hasMinor = typeof discount_minor === 'number' && Number.isFinite(discount_minor);
      const hasUsd = typeof usd_cents === 'number' && Number.isFinite(usd_cents);
      if (hasMinor === hasUsd) {
        return reply.code(400).send({ error: 'Provide exactly one of discount_minor or usd_cents' });
      }

      if (hasMinor && (discount_minor! <= 0 || discount_minor! > 1_000_000_000)) {
        return reply.code(400).send({ error: 'Invalid discount_minor' });
      }
      if (hasUsd && (usd_cents! <= 0 || usd_cents! > 1_000_000_000)) {
        return reply.code(400).send({ error: 'Invalid usd_cents' });
      }

      const uc = container.resolve<PreviewPriceMatchDiscountUseCase>(UC_TOKENS.PreviewPriceMatchDiscount);
      const result = await uc.execute({
        currency: currency.trim().toUpperCase(),
        discount_minor: hasMinor ? discount_minor : undefined,
        usd_cents: hasUsd ? usd_cents : undefined,
      });
      return reply.send(result);
    },
  );

  // ── Trusted Retailers ──────────────────────────────────────────────────

  app.get(
    '/retailers',
    { preHandler: [employeeGuard] },
    async (_request, reply) => {
      const uc = container.resolve<ListPriceMatchRetailersUseCase>(UC_TOKENS.ListPriceMatchRetailers);
      const result = await uc.execute();
      return reply.send({ retailers: result });
    },
  );

  app.post<{ Body: { name: string; domain: string; category: string } }>(
    '/retailers',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { name, domain, category } = request.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
        return reply.code(400).send({ error: 'Invalid name' });
      }
      if (!domain || !DOMAIN_RE.test(domain)) {
        return reply.code(400).send({ error: 'Invalid domain' });
      }
      if (!category || !VALID_RETAILER_CATEGORIES.has(category)) {
        return reply.code(400).send({ error: 'Invalid category' });
      }

      const uc = container.resolve<CreatePriceMatchRetailerUseCase>(UC_TOKENS.CreatePriceMatchRetailer);
      const id = await uc.execute({ name: name.trim(), domain: domain.toLowerCase().trim(), category });
      if (!id) return reply.code(500).send({ error: 'Failed to create retailer' });
      return reply.code(201).send({ id });
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; domain?: string; category?: string; is_active?: boolean } }>(
    '/retailers/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid retailer_id' });

      const { name, domain, category, is_active } = request.body;

      if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0 || name.length > 200)) {
        return reply.code(400).send({ error: 'Invalid name' });
      }
      if (domain !== undefined && !DOMAIN_RE.test(domain)) {
        return reply.code(400).send({ error: 'Invalid domain' });
      }
      if (category !== undefined && !VALID_RETAILER_CATEGORIES.has(category)) {
        return reply.code(400).send({ error: 'Invalid category' });
      }

      const uc = container.resolve<UpdatePriceMatchRetailerUseCase>(UC_TOKENS.UpdatePriceMatchRetailer);
      const success = await uc.execute({
        id,
        name: name?.trim(),
        domain: domain?.toLowerCase().trim(),
        category,
        is_active,
      });
      if (!success) return reply.code(404).send({ error: 'Retailer not found' });
      return reply.send({ success: true });
    },
  );

  // ── Blocked Domains ────────────────────────────────────────────────────

  app.get(
    '/blocked-domains',
    { preHandler: [employeeGuard] },
    async (_request, reply) => {
      const uc = container.resolve<ListPriceMatchBlockedDomainsUseCase>(UC_TOKENS.ListPriceMatchBlockedDomains);
      const result = await uc.execute();
      return reply.send({ blocked_domains: result });
    },
  );

  app.post<{ Body: { domain: string; notes?: string } }>(
    '/blocked-domains',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { domain, notes } = request.body;

      if (!domain || !DOMAIN_RE.test(domain)) {
        return reply.code(400).send({ error: 'Invalid domain' });
      }

      const uc = container.resolve<CreatePriceMatchBlockedDomainUseCase>(UC_TOKENS.CreatePriceMatchBlockedDomain);
      const id = await uc.execute({ domain: domain.toLowerCase().trim(), notes: notes?.trim().slice(0, 500) });
      if (!id) return reply.code(500).send({ error: 'Failed to create blocked domain' });
      return reply.code(201).send({ id });
    },
  );

  app.patch<{ Params: { id: string }; Body: { domain?: string; is_active?: boolean; notes?: string } }>(
    '/blocked-domains/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid blocked_domain_id' });

      const { domain, is_active, notes } = request.body;

      if (domain !== undefined && !DOMAIN_RE.test(domain)) {
        return reply.code(400).send({ error: 'Invalid domain' });
      }

      const uc = container.resolve<UpdatePriceMatchBlockedDomainUseCase>(UC_TOKENS.UpdatePriceMatchBlockedDomain);
      const success = await uc.execute({
        id,
        domain: domain?.toLowerCase().trim(),
        is_active,
        notes: notes !== undefined ? notes?.trim().slice(0, 500) ?? null : undefined,
      });
      if (!success) return reply.code(404).send({ error: 'Blocked domain not found' });
      return reply.send({ success: true });
    },
  );

  // ── Config ─────────────────────────────────────────────────────────────

  app.get(
    '/config',
    { preHandler: [employeeGuard] },
    async (_request, reply) => {
      const uc = container.resolve<GetPriceMatchConfigUseCase>(UC_TOKENS.GetPriceMatchConfig);
      const result = await uc.execute();
      return reply.send(result);
    },
  );

  app.put<{ Body: { config: Record<string, unknown> } }>(
    '/config',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { config } = request.body;
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return reply.code(400).send({ error: 'Invalid config object' });
      }

      const authUser = getAuthUser(request);
      const uc = container.resolve<UpdatePriceMatchConfigUseCase>(UC_TOKENS.UpdatePriceMatchConfig);
      const success = await uc.execute({ config, admin_id: authUser.id });
      if (!success) return reply.code(500).send({ error: 'Failed to update config' });
      return reply.send({ success: true });
    },
  );
}
