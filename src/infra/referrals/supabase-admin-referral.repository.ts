import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminReferralRepository } from '../../core/ports/admin-referral-repository.port.js';
import type {
  ListReferralsDto,
  ListReferralsResult,
  ListReferralLeaderboardDto,
  ListReferralLeaderboardResult,
  ResolveReferralDisputeDto,
  ResolveReferralDisputeResult,
  InvalidateReferralDto,
  InvalidateReferralResult,
  PayLeaderboardPrizesDto,
  PayLeaderboardPrizesResult,
} from '../../core/use-cases/referrals/referral.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminReferralRepository');

const DEFAULT_PAGE_LIMIT = 25;

@injectable()
export class SupabaseAdminReferralRepository implements IAdminReferralRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async listReferrals(dto: ListReferralsDto): Promise<ListReferralsResult> {
    const result = await this.db.rpc<{ referrals: unknown[]; total: number }>(
      'admin_list_referrals',
      {
        p_page: dto.page ?? 1,
        p_limit: dto.limit ?? DEFAULT_PAGE_LIMIT,
        p_status: dto.status ?? null,
      },
    );

    return {
      referrals: result.referrals ?? [],
      total: result.total ?? 0,
    };
  }

  async listReferralLeaderboard(dto: ListReferralLeaderboardDto): Promise<ListReferralLeaderboardResult> {
    const result = await this.db.rpc<{ leaderboard: unknown[] }>(
      'admin_list_referral_leaderboard',
      {
        p_period: dto.period ?? null,
        p_limit: dto.limit ?? 50,
      },
    );

    return { leaderboard: result.leaderboard ?? [] };
  }

  async resolveReferralDispute(dto: ResolveReferralDisputeDto): Promise<ResolveReferralDisputeResult> {
    logger.info('Resolving referral dispute', { disputeId: dto.dispute_id, resolution: dto.resolution });

    await this.db.rpc('admin_resolve_referral_dispute', {
      p_dispute_id: dto.dispute_id,
      p_resolution: dto.resolution,
      p_admin_id: dto.admin_id,
      p_reason: dto.reason ?? null,
    });

    return { success: true };
  }

  async invalidateReferral(dto: InvalidateReferralDto): Promise<InvalidateReferralResult> {
    logger.info('Invalidating referral', { referralId: dto.referral_id, adminId: dto.admin_id });

    await this.db.rpc('admin_invalidate_referral', {
      p_referral_id: dto.referral_id,
      p_admin_id: dto.admin_id,
      p_reason: dto.reason,
    });

    return { success: true };
  }

  async payLeaderboardPrizes(dto: PayLeaderboardPrizesDto): Promise<PayLeaderboardPrizesResult> {
    logger.info('Paying leaderboard prizes', { period: dto.period, adminId: dto.admin_id });

    const result = await this.db.rpc<{ prizes_paid: number; total_amount_cents: number }>(
      'admin_pay_leaderboard_prizes',
      {
        p_period: dto.period,
        p_admin_id: dto.admin_id,
      },
    );

    return {
      success: true,
      prizes_paid: result.prizes_paid,
      total_amount_cents: result.total_amount_cents,
    };
  }
}
