import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { ListRateLimitUnlocksFilters, ListRateLimitUnlocksResult } from './security.types.js';

@injectable()
export class ListRateLimitUnlocksUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(filters: ListRateLimitUnlocksFilters): Promise<ListRateLimitUnlocksResult> {
    return this.repo.listRateLimitUnlocks(filters);
  }
}
