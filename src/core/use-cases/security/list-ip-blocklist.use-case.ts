import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { ListIpBlocklistFilters, ListIpBlocklistResult } from './security.types.js';

@injectable()
export class ListIpBlocklistUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(filters: ListIpBlocklistFilters): Promise<ListIpBlocklistResult> {
    return this.repo.listIpBlocklist(filters);
  }
}
