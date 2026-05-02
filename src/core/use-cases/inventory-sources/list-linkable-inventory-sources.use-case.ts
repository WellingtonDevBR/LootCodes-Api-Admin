import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventorySourceRepository } from '../../ports/admin-inventory-source-repository.port.js';
import type { ListLinkableInventorySourcesDto, ListLinkableInventorySourcesResult } from './inventory-source.types.js';

@injectable()
export class ListLinkableInventorySourcesUseCase {
  constructor(
    @inject(TOKENS.AdminInventorySourceRepository) private repo: IAdminInventorySourceRepository,
  ) {}

  async execute(dto: ListLinkableInventorySourcesDto): Promise<ListLinkableInventorySourcesResult> {
    return this.repo.listLinkableInventorySources(dto);
  }
}
