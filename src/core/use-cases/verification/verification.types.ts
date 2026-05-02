export interface ApproveVerificationDto { verification_id: string; admin_id: string }
export interface ApproveVerificationResult { success: boolean }
export interface DenyVerificationDto { verification_id: string; admin_id: string; reason: string }
export interface DenyVerificationResult { success: boolean }
