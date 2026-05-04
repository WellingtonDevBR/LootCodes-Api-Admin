import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { BlockedDomainRow } from './price-match.types.js';

@injectable()
export class ListPriceMatchBlockedDomainsUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(): Promise<BlockedDomainRow[]> {
    return this.repo.listBlockedDomains();
  }
}
