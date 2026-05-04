// ── Row types ────────────────────────────────────────────────────────────

export interface AdminReferralRow {
  id: string;
  status: string;
  referral_code: string;
  referrer_user_id: string;
  referee_user_id: string;
  referee_email: string | null;
  referrer_grant_cents: number | null;
  referee_grant_cents: number | null;
  qualifying_order_id: string | null;
  dispute_reason: string | null;
  dispute_resolution: string | null;
  dispute_opened_at: string | null;
  dispute_resolved_at: string | null;
  dispute_resolved_by: string | null;
  invalidated_reason: string | null;
  fingerprint_referee: string | null;
  ip_hash_referee: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  email: string | null;
  country: string;
  referrals_count: number;
  earned_cents: number;
}

export interface PrizeInput {
  rank: number;
  user_id: string;
  cents: number;
}

// ── DTOs ─────────────────────────────────────────────────────────────────

export interface ListReferralsDto {
  status?: string;
  referrer_user_id?: string;
  referee_user_id?: string;
  email?: string;
  code?: string;
  before?: string;
  limit?: number;
}

export interface ListReferralsResult {
  entries: AdminReferralRow[];
  next_cursor: string | null;
}

export interface ListReferralLeaderboardDto {
  days?: number;
  limit?: number;
}

export interface ListReferralLeaderboardResult {
  entries: LeaderboardEntry[];
  days: number;
  limit: number;
}

export interface ResolveReferralDisputeDto {
  referral_id: string;
  resolution: 'uphold' | 'reject';
  admin_id: string;
  notes?: string;
}

export interface ResolveReferralDisputeResult {
  ok: boolean;
  resolution?: string;
  referrer_reversed_cents: number;
  referee_reversed_cents: number;
}

export interface InvalidateReferralDto {
  referral_id: string;
  admin_id: string;
  reason: string;
}

export interface InvalidateReferralResult {
  ok: boolean;
  referrer_reversed_cents: number;
  referee_reversed_cents: number;
}

export interface PayLeaderboardPrizesDto {
  period_key: string;
  prizes: PrizeInput[];
  admin_id: string;
}

export interface PayLeaderboardPrizesResult {
  ok: boolean;
  period_key: string;
  granted_count: number;
  granted_total_cents: number;
}
