import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { SetVariantSalesBlockedDto, SetVariantSalesBlockedResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class SetVariantSalesBlockedUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: SetVariantSalesBlockedDto): Promise<SetVariantSalesBlockedResult> {
    if (!dto.variant_id) throw new ValidationError('Variant ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.setVariantSalesBlocked(dto);
  }
}
