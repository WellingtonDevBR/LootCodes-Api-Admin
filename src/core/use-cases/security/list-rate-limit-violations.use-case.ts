import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { ListRateLimitViolationsFilters, ListRateLimitViolationsResult } from './security.types.js';

@injectable()
export class ListRateLimitViolationsUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(filters: ListRateLimitViolationsFilters): Promise<ListRateLimitViolationsResult> {
    return this.repo.listRateLimitViolations(filters);
  }
}
