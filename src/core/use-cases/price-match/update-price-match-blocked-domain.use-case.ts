import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { UpdateBlockedDomainDto } from './price-match.types.js';

@injectable()
export class UpdatePriceMatchBlockedDomainUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(dto: UpdateBlockedDomainDto): Promise<boolean> {
    return this.repo.updateBlockedDomain(dto);
  }
}
