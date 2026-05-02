export interface ListTrustpilotReviewClaimsDto { page?: number; limit?: number; status?: string }
export interface ListTrustpilotReviewClaimsResult { claims: unknown[]; total: number }
export interface ResolveTrustpilotReviewClaimDto { claim_id: string; resolution: 'approve' | 'reject'; admin_id: string; reason?: string }
export interface ResolveTrustpilotReviewClaimResult { success: boolean }
