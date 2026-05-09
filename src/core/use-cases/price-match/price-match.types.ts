// ── Claim Row ────────────────────────────────────────────────────────────

export interface PriceMatchClaimRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
  user_id: string | null;
  guest_email: string | null;
  product_id: string;
  variant_id: string;
  retailer_id: string | null;
  competitor_host: string;
  competitor_url: string;
  competitor_price_cents: number;
  competitor_currency: string;
  competitor_price_usd_cents: number;
  screenshot_path: string;
  our_price_usd_cents: number;
  our_price_display_cents: number;
  display_currency: string;
  exchange_rate_used: number | null;
  discount_type: string | null;
  discount_value: number | null;
  beat_percentage: number | null;
  promo_code_id: string | null;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  ip_address: string | null;
  fingerprint_hash: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  product?: { name: string; slug: string; image_url: string | null } | null;
  variant?: { id: string; price_usd: number } | null;
  retailer?: { name: string; domain: string; category: string } | null;
}

// ── Confidence / Risk ────────────────────────────────────────────────────

export interface RiskFlag {
  key: string;
  label: string;
  severity: 'red' | 'yellow' | 'green';
}

export interface ClaimConfidenceResult {
  score: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  retailerTier: string;
  riskFlags: RiskFlag[];
  costFloor: number | null;
  userOrderCount: number;
  accountAgeDays: number;
  claimCountToday: number;
}

// ── Trusted Retailers ────────────────────────────────────────────────────

export interface TrustedRetailerRow {
  id: string;
  name: string;
  domain: string;
  category: string;
  is_active: boolean;
}

export interface CreateRetailerDto {
  name: string;
  domain: string;
  category: string;
}

export interface UpdateRetailerDto {
  id: string;
  name?: string;
  domain?: string;
  category?: string;
  is_active?: boolean;
}

// ── Blocked Domains ──────────────────────────────────────────────────────

export interface BlockedDomainRow {
  id: string;
  domain: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateBlockedDomainDto {
  domain: string;
  notes?: string | null;
}

export interface UpdateBlockedDomainDto {
  id: string;
  domain?: string;
  is_active?: boolean;
  notes?: string | null;
}

// ── List Claims ──────────────────────────────────────────────────────────

export interface ListClaimsDto {
  status?: string;
  user_id?: string;
  guest_email?: string;
  limit?: number;
  offset?: number;
}

export interface ListClaimsResult {
  entries: PriceMatchClaimRow[];
  total: number;
}

// ── Approve ──────────────────────────────────────────────────────────────

export interface ApprovePriceMatchDto {
  claim_id: string;
  admin_id: string;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  admin_notes?: string;
}

export interface ApprovePriceMatchResult {
  success: boolean;
  promo_code?: string;
  error?: string;
}

// ── Reject ───────────────────────────────────────────────────────────────

export interface RejectPriceMatchDto {
  claim_id: string;
  admin_id: string;
  rejection_reason: string;
  admin_notes?: string;
}

export interface RejectPriceMatchResult {
  success: boolean;
  error?: string;
}

// ── Preview Discount (FX) ────────────────────────────────────────────────

export interface PreviewPriceMatchDiscountDto {
  currency: string;
  discount_minor?: number;
  usd_cents?: number;
}

export interface PreviewPriceMatchDiscountResult {
  usd_cents_equivalent?: number;
  discount_minor?: number;
}

// ── Screenshot ───────────────────────────────────────────────────────────

export interface GetScreenshotUrlDto {
  screenshot_path: string;
}

export interface GetScreenshotUrlResult {
  url: string | null;
}

// ── Config ───────────────────────────────────────────────────────────────

export interface PriceMatchConfigResult {
  config: Record<string, unknown> | null;
}

export interface UpdatePriceMatchConfigDto {
  config: Record<string, unknown>;
  admin_id: string;
}

// ── Cron use-case results ─────────────────────────────────────────────────

export interface ExpirePriceMatchClaimsResult {
  expiredCount: number;
}

export interface ProcessPriceDropRefundsResult {
  grantedCount: number;
}
