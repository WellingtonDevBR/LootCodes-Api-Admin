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
  SettlePendingBatchResult,
} from '../use-cases/referrals/referral.types.js';

export interface IAdminReferralRepository {
  listReferrals(dto: ListReferralsDto): Promise<ListReferralsResult>;
  listLeaderboard(dto: ListReferralLeaderboardDto): Promise<ListReferralLeaderboardResult>;
  resolveDispute(dto: ResolveReferralDisputeDto): Promise<ResolveReferralDisputeResult>;
  invalidate(dto: InvalidateReferralDto): Promise<InvalidateReferralResult>;
  payPrizes(dto: PayLeaderboardPrizesDto): Promise<PayLeaderboardPrizesResult>;

  // Cron operations
  settlePendingBatch(batchSize: number): Promise<SettlePendingBatchResult>;
}
