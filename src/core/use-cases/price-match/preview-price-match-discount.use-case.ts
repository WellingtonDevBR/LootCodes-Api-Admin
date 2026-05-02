import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { PreviewPriceMatchDiscountDto, PreviewPriceMatchDiscountResult } from './price-match.types.js';

@injectable()
export class PreviewPriceMatchDiscountUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(dto: PreviewPriceMatchDiscountDto): Promise<PreviewPriceMatchDiscountResult> {
    return this.repo.previewPriceMatchDiscount(dto);
  }
}
