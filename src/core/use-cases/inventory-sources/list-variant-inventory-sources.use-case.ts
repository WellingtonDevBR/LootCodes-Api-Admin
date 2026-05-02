import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventorySourceRepository } from '../../ports/admin-inventory-source-repository.port.js';
import type { ListVariantInventorySourcesDto, ListVariantInventorySourcesResult } from './inventory-source.types.js';

@injectable()
export class ListVariantInventorySourcesUseCase {
  constructor(
    @inject(TOKENS.AdminInventorySourceRepository) private repo: IAdminInventorySourceRepository,
  ) {}

  async execute(dto: ListVariantInventorySourcesDto): Promise<ListVariantInventorySourcesResult> {
    return this.repo.listVariantInventorySources(dto);
  }
}
