import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { UpdateVariantPriceDto, UpdateVariantPriceResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class UpdateVariantPriceUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: UpdateVariantPriceDto): Promise<UpdateVariantPriceResult> {
    if (!dto.variant_id) throw new ValidationError('Variant ID is required');
    if (!Number.isInteger(dto.price_cents) || dto.price_cents < 0) {
      throw new ValidationError('Price must be a non-negative integer (cents)');
    }
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.updateVariantPrice(dto);
  }
}
