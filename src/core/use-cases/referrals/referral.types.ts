export interface ListReferralsDto { page?: number; limit?: number; status?: string }
export interface ListReferralsResult { referrals: unknown[]; total: number }
export interface ListReferralLeaderboardDto { period?: string; limit?: number }
export interface ListReferralLeaderboardResult { leaderboard: unknown[] }
export interface ResolveReferralDisputeDto { dispute_id: string; resolution: 'approve' | 'reject'; admin_id: string; reason?: string }
export interface ResolveReferralDisputeResult { success: boolean }
export interface InvalidateReferralDto { referral_id: string; admin_id: string; reason: string }
export interface InvalidateReferralResult { success: boolean }
export interface PayLeaderboardPrizesDto { period: string; admin_id: string }
export interface PayLeaderboardPrizesResult { success: boolean; prizes_paid: number; total_amount_cents: number }
