import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { EmitInventoryStockChangedDto, EmitInventoryStockChangedResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class EmitInventoryStockChangedUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: EmitInventoryStockChangedDto): Promise<EmitInventoryStockChangedResult> {
    if (!dto.product_ids.length) throw new ValidationError('At least one product ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.emitInventoryStockChanged(dto);
  }
}
