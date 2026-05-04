import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { UpdatePriceMatchConfigDto } from './price-match.types.js';

@injectable()
export class UpdatePriceMatchConfigUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(dto: UpdatePriceMatchConfigDto): Promise<boolean> {
    return this.repo.updateConfig(dto);
  }
}
