import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { ListSellerListingsDto, ListSellerListingsResult } from './seller.types.js';

@injectable()
export class ListSellerListingsUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: ListSellerListingsDto): Promise<ListSellerListingsResult> {
    if (!dto.variant_id) {
      throw new Error('variant_id is required');
    }
    return this.repo.listSellerListingsForVariant(dto);
  }
}
