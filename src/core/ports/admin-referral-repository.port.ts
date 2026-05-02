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
} from '../use-cases/referrals/referral.types.js';

export interface IAdminReferralRepository {
  listReferrals(dto: ListReferralsDto): Promise<ListReferralsResult>;
  listReferralLeaderboard(dto: ListReferralLeaderboardDto): Promise<ListReferralLeaderboardResult>;
  resolveReferralDispute(dto: ResolveReferralDisputeDto): Promise<ResolveReferralDisputeResult>;
  invalidateReferral(dto: InvalidateReferralDto): Promise<InvalidateReferralResult>;
  payLeaderboardPrizes(dto: PayLeaderboardPrizesDto): Promise<PayLeaderboardPrizesResult>;
}
