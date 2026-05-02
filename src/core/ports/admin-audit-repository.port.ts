import type {
  ListAuditLogDto,
  ListAuditLogResult,
} from '../use-cases/audit/audit.types.js';

export interface IAdminAuditRepository {
  listAuditLog(dto: ListAuditLogDto): Promise<ListAuditLogResult>;
}
