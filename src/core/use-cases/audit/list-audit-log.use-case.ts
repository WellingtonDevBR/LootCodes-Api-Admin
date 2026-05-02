import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAuditRepository } from '../../ports/admin-audit-repository.port.js';
import type { ListAuditLogDto, ListAuditLogResult } from './audit.types.js';

@injectable()
export class ListAuditLogUseCase {
  constructor(
    @inject(TOKENS.AdminAuditRepository) private repo: IAdminAuditRepository,
  ) {}

  async execute(dto: ListAuditLogDto): Promise<ListAuditLogResult> {
    return this.repo.listAuditLog(dto);
  }
}
