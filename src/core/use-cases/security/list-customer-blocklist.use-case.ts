import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { ListCustomerBlocklistFilters, ListCustomerBlocklistResult } from './security.types.js';

@injectable()
export class ListCustomerBlocklistUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(filters: ListCustomerBlocklistFilters): Promise<ListCustomerBlocklistResult> {
    return this.repo.listCustomerBlocklist(filters);
  }
}
