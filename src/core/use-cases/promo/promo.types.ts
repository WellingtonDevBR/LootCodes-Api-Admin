export interface CreatePromoCodeDto {
  code: string;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  max_uses?: number;
  min_order_cents?: number;
  starts_at?: string;
  expires_at?: string;
  product_ids?: string[];
  target_audience?: Record<string, unknown>;
  admin_id: string;
}
export interface CreatePromoCodeResult { id: string; code: string }

export interface UpdatePromoCodeDto { promo_id: string; updates: Partial<CreatePromoCodeDto>; admin_id: string }
export interface UpdatePromoCodeResult { success: boolean }

export interface TogglePromoActiveDto { promo_id: string; active: boolean; admin_id: string }
export interface TogglePromoActiveResult { success: boolean }

export interface DeletePromoCodeDto { promo_id: string; admin_id: string }
export interface DeletePromoCodeResult { success: boolean }

export interface SubmitPromoApprovalDto { promo_id: string; admin_id: string }
export interface SubmitPromoApprovalResult { success: boolean }

export interface ApprovePromoCodeDto { promo_id: string; admin_id: string }
export interface ApprovePromoCodeResult { success: boolean }

export interface RejectPromoCodeDto { promo_id: string; admin_id: string; reason: string }
export interface RejectPromoCodeResult { success: boolean }

export interface SendPromoNotificationsDto { promo_id: string; admin_id: string }
export interface SendPromoNotificationsResult { success: boolean; notifications_queued: number }

export interface EstimatePromoReachDto { target_audience: Record<string, unknown> }
export interface EstimatePromoReachResult { estimated_reach: number }

export interface ListPromoCodesDto { page?: number; limit?: number; search?: string; status?: string }
export interface ListPromoCodesResult { promo_codes: unknown[]; total: number }

export interface GetPromoUsageStatsDto { promo_id: string }
export interface GetPromoUsageStatsResult { stats: unknown }
