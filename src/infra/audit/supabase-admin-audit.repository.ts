import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminAuditRepository } from '../../core/ports/admin-audit-repository.port.js';
import type {
  ListAuditLogDto,
  ListAuditLogResult,
} from '../../core/use-cases/audit/audit.types.js';

const DEFAULT_PAGE_LIMIT = 25;

@injectable()
export class SupabaseAdminAuditRepository implements IAdminAuditRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async listAuditLog(dto: ListAuditLogDto): Promise<ListAuditLogResult> {
    const result = await this.db.rpc<{ entries: unknown[]; total: number }>(
      'admin_list_audit_log',
      {
        p_page: dto.page ?? 1,
        p_limit: dto.limit ?? DEFAULT_PAGE_LIMIT,
        p_action: dto.action ?? null,
        p_admin_id_filter: dto.admin_id_filter ?? null,
      },
    );

    return {
      entries: result.entries ?? [],
      total: result.total ?? 0,
    };
  }
}
