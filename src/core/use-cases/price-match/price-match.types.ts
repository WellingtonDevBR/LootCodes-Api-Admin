export interface ApprovePriceMatchDto { claim_id: string; admin_id: string; discount_cents?: number }
export interface ApprovePriceMatchResult { success: boolean; promo_code?: string }
export interface RejectPriceMatchDto { claim_id: string; admin_id: string; reason: string }
export interface RejectPriceMatchResult { success: boolean }
export interface PreviewPriceMatchDiscountDto { claim_id: string }
export interface PreviewPriceMatchDiscountResult { suggested_discount_cents: number; confidence: number }
