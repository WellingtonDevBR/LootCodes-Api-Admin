import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { GetInventoryCatalogDto, GetInventoryCatalogResult } from './inventory.types.js';

@injectable()
export class GetInventoryCatalogUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private inventoryRepo: IAdminInventoryRepository,
  ) {}

  async execute(dto: GetInventoryCatalogDto): Promise<GetInventoryCatalogResult> {
    return this.inventoryRepo.getInventoryCatalog(dto);
  }
}
