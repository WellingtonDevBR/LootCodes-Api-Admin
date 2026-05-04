import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminReferralRepository } from '../../core/ports/admin-referral-repository.port.js';
import type {
  AdminReferralRow,
  ListReferralsDto,
  ListReferralsResult,
  ListReferralLeaderboardDto,
  ListReferralLeaderboardResult,
  LeaderboardEntry,
  ResolveReferralDisputeDto,
  ResolveReferralDisputeResult,
  InvalidateReferralDto,
  InvalidateReferralResult,
  PayLeaderboardPrizesDto,
  PayLeaderboardPrizesResult,
} from '../../core/use-cases/referrals/referral.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminReferralRepository');

const REFERRAL_SELECT = `
  id, status, referral_code, referrer_user_id, referee_user_id, referee_email,
  referrer_grant_cents, referee_grant_cents, qualifying_order_id,
  dispute_reason, dispute_resolution, dispute_opened_at, dispute_resolved_at, dispute_resolved_by,
  invalidated_reason, fingerprint_referee, ip_hash_referee, created_at, completed_at
`.replace(/\s+/g, ' ').trim();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function clampLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_LIMIT);
}

interface ReferralAggRow {
  referrer_user_id: string;
  referrer_grant_cents: number | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  country: string | null;
}

@injectable()
export class SupabaseAdminReferralRepository implements IAdminReferralRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async listReferrals(dto: ListReferralsDto): Promise<ListReferralsResult> {
    const limit = clampLimit(dto.limit);

    const eq: Array<[string, unknown]> = [];
    if (dto.status) eq.push(['status', dto.status]);
    if (dto.referrer_user_id) eq.push(['referrer_user_id', dto.referrer_user_id]);
    if (dto.referee_user_id) eq.push(['referee_user_id', dto.referee_user_id]);

    const ilike: Array<[string, string]> = [];
    if (dto.email) ilike.push(['referee_email', `%${dto.email}%`]);
    if (dto.code) ilike.push(['referral_code', `${dto.code.toUpperCase()}%`]);

    const lt: Array<[string, unknown]> | undefined = dto.before
      ? [['created_at', dto.before]]
      : undefined;

    const entries = await this.db.query<AdminReferralRow>('referrals', {
      select: REFERRAL_SELECT,
      eq: eq.length > 0 ? eq : undefined,
      ilike: ilike.length > 0 ? ilike : undefined,
      lt,
      order: { column: 'created_at', ascending: false },
      limit,
    });

    const nextCursor = entries.length === limit
      ? entries[entries.length - 1]?.created_at ?? null
      : null;

    return { entries, next_cursor: nextCursor };
  }

  async listLeaderboard(dto: ListReferralLeaderboardDto): Promise<ListReferralLeaderboardResult> {
    const days = Math.min(Math.max(dto.days ?? 30, 1), 365);
    const limit = clampLimit(dto.limit);
    const windowStart = new Date(Date.now() - days * 86_400_000).toISOString();

    const rows = await this.db.query<ReferralAggRow>('referrals', {
      select: 'referrer_user_id, referrer_grant_cents',
      eq: [['status', 'completed']],
      gte: [['completed_at', windowStart]],
    });

    const byUser = new Map<string, { count: number; cents: number }>();
    for (const row of rows) {
      const existing = byUser.get(row.referrer_user_id) ?? { count: 0, cents: 0 };
      existing.count += 1;
      existing.cents += row.referrer_grant_cents ?? 0;
      byUser.set(row.referrer_user_id, existing);
    }

    const sorted = [...byUser.entries()]
      .map(([userId, agg]) => ({ user_id: userId, ...agg }))
      .sort((a, b) => (b.cents - a.cents) || (b.count - a.count) || a.user_id.localeCompare(b.user_id))
      .slice(0, limit);

    if (sorted.length === 0) {
      return { entries: [], days, limit };
    }

    const userIds = sorted.map((s) => s.user_id);
    const profiles = await this.db.query<ProfileRow>('profiles', {
      select: 'id, full_name, email, country',
      in: [['id', userIds]],
    });

    const profileMap = new Map<string, ProfileRow>(profiles.map((p) => [p.id, p]));

    const entries: LeaderboardEntry[] = sorted.map((row, idx) => {
      const profile = profileMap.get(row.user_id);
      return {
        rank: idx + 1,
        user_id: row.user_id,
        display_name: profile?.full_name?.trim() || profile?.email || row.user_id.slice(0, 8),
        email: profile?.email ?? null,
        country: profile?.country ?? '',
        referrals_count: row.count,
        earned_cents: row.cents,
      };
    });

    return { entries, days, limit };
  }

  async resolveDispute(dto: ResolveReferralDisputeDto): Promise<ResolveReferralDisputeResult> {
    logger.info('Resolving referral dispute', { referralId: dto.referral_id, resolution: dto.resolution });

    const result = await this.db.rpc<{
      ok?: boolean;
      reason?: string;
      resolution?: string;
      referrer_reversed_cents?: number;
      referee_reversed_cents?: number;
    }>('referral_dispute_resolve', {
      p_referral_id: dto.referral_id,
      p_admin_user_id: dto.admin_id,
      p_resolution: dto.resolution,
      p_notes: dto.notes ?? null,
    });

    if (!result.ok) {
      throw new Error(result.reason ?? 'Failed to resolve dispute');
    }

    return {
      ok: true,
      resolution: result.resolution,
      referrer_reversed_cents: result.referrer_reversed_cents ?? 0,
      referee_reversed_cents: result.referee_reversed_cents ?? 0,
    };
  }

  async invalidate(dto: InvalidateReferralDto): Promise<InvalidateReferralResult> {
    logger.info('Invalidating referral', { referralId: dto.referral_id, adminId: dto.admin_id });

    const result = await this.db.rpc<{
      ok?: boolean;
      reason?: string;
      referrer_reversed_cents?: number;
      referee_reversed_cents?: number;
    }>('referral_invalidate', {
      p_referral_id: dto.referral_id,
      p_admin_user_id: dto.admin_id,
      p_reason: dto.reason,
    });

    if (!result.ok) {
      throw new Error(result.reason ?? 'Failed to invalidate referral');
    }

    return {
      ok: true,
      referrer_reversed_cents: result.referrer_reversed_cents ?? 0,
      referee_reversed_cents: result.referee_reversed_cents ?? 0,
    };
  }

  async payPrizes(dto: PayLeaderboardPrizesDto): Promise<PayLeaderboardPrizesResult> {
    logger.info('Paying leaderboard prizes', { periodKey: dto.period_key, adminId: dto.admin_id });

    const result = await this.db.rpc<{
      ok?: boolean;
      reason?: string;
      granted_count?: number;
      granted_total_cents?: number;
    }>('referral_leaderboard_pay_prizes', {
      p_admin_user_id: dto.admin_id,
      p_period_key: dto.period_key,
      p_prizes_jsonb: dto.prizes,
    });

    if (!result.ok) {
      throw new Error(result.reason ?? 'Failed to pay prizes');
    }

    return {
      ok: true,
      period_key: dto.period_key,
      granted_count: result.granted_count ?? 0,
      granted_total_cents: result.granted_total_cents ?? 0,
    };
  }
}
