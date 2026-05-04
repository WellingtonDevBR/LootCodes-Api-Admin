import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { UpdateRetailerDto } from './price-match.types.js';

@injectable()
export class UpdatePriceMatchRetailerUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(dto: UpdateRetailerDto): Promise<boolean> {
    return this.repo.updateRetailer(dto);
  }
}
