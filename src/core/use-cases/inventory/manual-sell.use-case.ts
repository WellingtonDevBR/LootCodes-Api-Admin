import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { ManualSellDto, ManualSellResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class ManualSellUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: ManualSellDto): Promise<ManualSellResult> {
    if (!dto.variant_id) throw new ValidationError('Variant ID is required');
    if (dto.quantity < 1) throw new ValidationError('Quantity must be at least 1');
    if (!dto.buyer_email) throw new ValidationError('Buyer email is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.manualSell(dto);
  }
}
