import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { ListAuditLogFilters, ListAuditLogResult } from './security.types.js';

@injectable()
export class ListSecurityAuditLogUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(filters: ListAuditLogFilters): Promise<ListAuditLogResult> {
    return this.repo.listAuditLog(filters);
  }
}
