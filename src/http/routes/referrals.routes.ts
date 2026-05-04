import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { ListReferralsUseCase } from '../../core/use-cases/referrals/list-referrals.use-case.js';
import type { ListReferralLeaderboardUseCase } from '../../core/use-cases/referrals/list-referral-leaderboard.use-case.js';
import type { ResolveReferralDisputeUseCase } from '../../core/use-cases/referrals/resolve-referral-dispute.use-case.js';
import type { InvalidateReferralUseCase } from '../../core/use-cases/referrals/invalidate-referral.use-case.js';
import type { PayLeaderboardPrizesUseCase } from '../../core/use-cases/referrals/pay-leaderboard-prizes.use-case.js';
import type { PrizeInput } from '../../core/use-cases/referrals/referral.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(['pending_first_order', 'completed', 'disputed', 'invalidated']);
const MAX_PRIZES = 100;
const MAX_CENTS_PER_PRIZE = 500_000;
const PERIOD_KEY_RE = /^[a-z0-9][a-z0-9\-_:]{0,63}$/i;

function getAuthUser(request: unknown): { id: string } {
  return (request as Record<string, unknown>).authUser as { id: string };
}

export async function adminReferralRoutes(app: FastifyInstance) {
  // GET /referrals — list with filters and cursor pagination
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/',
    { preHandler: [employeeGuard] },
    async (request, reply) => {
      const q = request.query;
      const status = q.status && VALID_STATUSES.has(q.status) ? q.status : undefined;
      const referrer_user_id = q.referrer_user_id && UUID_RE.test(q.referrer_user_id) ? q.referrer_user_id : undefined;
      const referee_user_id = q.referee_user_id && UUID_RE.test(q.referee_user_id) ? q.referee_user_id : undefined;
      const email = q.email?.trim().slice(0, 320) || undefined;
      const code = q.code?.trim().toUpperCase().slice(0, 32) || undefined;
      const before = q.before && !isNaN(Date.parse(q.before)) ? new Date(q.before).toISOString() : undefined;
      const limit = q.limit ? parseInt(q.limit, 10) : undefined;

      const uc = container.resolve<ListReferralsUseCase>(UC_TOKENS.ListReferrals);
      const result = await uc.execute({ status, referrer_user_id, referee_user_id, email, code, before, limit });
      return reply.send(result);
    },
  );

  // GET /referrals/leaderboard — ranked referrers in time window
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/leaderboard',
    { preHandler: [employeeGuard] },
    async (request, reply) => {
      const q = request.query;
      const days = q.days ? parseInt(q.days, 10) : undefined;
      const limit = q.limit ? parseInt(q.limit, 10) : undefined;

      const uc = container.resolve<ListReferralLeaderboardUseCase>(UC_TOKENS.ListReferralLeaderboard);
      const result = await uc.execute({ days, limit });
      return reply.send(result);
    },
  );

  // POST /referrals/disputes/:id/resolve — uphold or reject a dispute
  app.post<{ Params: { id: string }; Body: { resolution: string; notes?: string } }>(
    '/disputes/:id/resolve',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid referral_id' });

      const { resolution, notes } = request.body;
      if (resolution !== 'uphold' && resolution !== 'reject') {
        return reply.code(400).send({ error: 'resolution must be uphold or reject' });
      }

      const authUser = getAuthUser(request);
      const uc = container.resolve<ResolveReferralDisputeUseCase>(UC_TOKENS.ResolveReferralDispute);
      const result = await uc.execute({
        referral_id: id,
        resolution: resolution as 'uphold' | 'reject',
        admin_id: authUser.id,
        notes: notes?.trim().slice(0, 1000) || undefined,
      });
      return reply.send(result);
    },
  );

  // POST /referrals/:id/invalidate — force-invalidate a referral (fraud path)
  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/:id/invalidate',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid referral_id' });

      const { reason } = request.body;
      if (!reason || reason.trim().length === 0) {
        return reply.code(400).send({ error: 'reason is required' });
      }

      const authUser = getAuthUser(request);
      const uc = container.resolve<InvalidateReferralUseCase>(UC_TOKENS.InvalidateReferral);
      const result = await uc.execute({
        referral_id: id,
        admin_id: authUser.id,
        reason: reason.trim().slice(0, 500),
      });
      return reply.send(result);
    },
  );

  // POST /referrals/leaderboard/pay-prizes — pay seasonal prizes
  app.post<{ Body: { period_key: string; prizes: unknown[] } }>(
    '/leaderboard/pay-prizes',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { period_key, prizes: rawPrizes } = request.body;

      if (!period_key || !PERIOD_KEY_RE.test(period_key)) {
        return reply.code(400).send({ error: 'Invalid period_key' });
      }
      if (!Array.isArray(rawPrizes) || rawPrizes.length === 0) {
        return reply.code(400).send({ error: 'prizes must be a non-empty array' });
      }
      if (rawPrizes.length > MAX_PRIZES) {
        return reply.code(400).send({ error: `prizes cannot exceed ${MAX_PRIZES} entries` });
      }

      const prizes: PrizeInput[] = [];
      const seenRanks = new Set<number>();
      for (const raw of rawPrizes) {
        if (!raw || typeof raw !== 'object') {
          return reply.code(400).send({ error: 'each prize must be an object' });
        }
        const p = raw as Record<string, unknown>;
        const rank = Number(p.rank);
        const cents = Number(p.cents);
        const uid = typeof p.user_id === 'string' ? p.user_id : '';

        if (!Number.isInteger(rank) || rank < 1 || rank > 10000) {
          return reply.code(400).send({ error: `invalid rank: ${p.rank}` });
        }
        if (seenRanks.has(rank)) {
          return reply.code(400).send({ error: `duplicate rank: ${rank}` });
        }
        if (!Number.isInteger(cents) || cents <= 0 || cents > MAX_CENTS_PER_PRIZE) {
          return reply.code(400).send({ error: `invalid cents for rank ${rank}` });
        }
        if (!UUID_RE.test(uid)) {
          return reply.code(400).send({ error: `invalid user_id for rank ${rank}` });
        }

        seenRanks.add(rank);
        prizes.push({ rank, user_id: uid, cents });
      }

      const authUser = getAuthUser(request);
      const uc = container.resolve<PayLeaderboardPrizesUseCase>(UC_TOKENS.PayLeaderboardPrizes);
      const result = await uc.execute({
        period_key,
        prizes,
        admin_id: authUser.id,
      });
      return reply.send(result);
    },
  );
}
