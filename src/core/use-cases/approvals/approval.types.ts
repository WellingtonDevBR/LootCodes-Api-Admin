export interface RequestActionDto { action: string; target_id: string; target_type: string; summary: string; admin_id: string; payload?: Record<string, unknown> }
export interface RequestActionResult { request_id: string }
export interface ApproveActionDto { request_id: string; admin_id: string }
export interface ApproveActionResult { success: boolean }
export interface RejectActionDto { request_id: string; admin_id: string; reason: string }
export interface RejectActionResult { success: boolean }
export interface ListActionRequestsDto { page?: number; limit?: number; status?: string }
export interface ListActionRequestsResult { requests: unknown[]; total: number }
