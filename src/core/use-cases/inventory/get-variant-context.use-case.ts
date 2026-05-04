import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { GetVariantContextDto, GetVariantContextResult } from './inventory.types.js';

@injectable()
export class GetVariantContextUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private inventoryRepo: IAdminInventoryRepository,
  ) {}

  async execute(dto: GetVariantContextDto): Promise<GetVariantContextResult> {
    return this.inventoryRepo.getVariantContext(dto);
  }
}