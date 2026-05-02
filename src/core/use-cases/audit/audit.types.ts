export interface ListAuditLogDto { page?: number; limit?: number; action?: string; admin_id_filter?: string }
export interface ListAuditLogResult { entries: unknown[]; total: number }
