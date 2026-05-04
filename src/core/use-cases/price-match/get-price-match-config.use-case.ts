import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { PriceMatchConfigResult } from './price-match.types.js';

@injectable()
export class GetPriceMatchConfigUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(): Promise<PriceMatchConfigResult> {
    return this.repo.getConfig();
  }
}
