export interface SendAdminSmsDto { phone: string; admin_id: string }
export interface SendAdminSmsResult { success: boolean }
export interface VerifyAdminSmsDto { phone: string; code: string; admin_id: string }
export interface VerifyAdminSmsResult { success: boolean; verified: boolean }
export interface SendSecurityAlertSmsDto { message: string; severity: string }
export interface SendSecurityAlertSmsResult { success: boolean }
