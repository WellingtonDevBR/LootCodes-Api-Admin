import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { CreateBlockedDomainDto } from './price-match.types.js';

@injectable()
export class CreatePriceMatchBlockedDomainUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(dto: CreateBlockedDomainDto): Promise<string | null> {
    return this.repo.createBlockedDomain(dto);
  }
}
