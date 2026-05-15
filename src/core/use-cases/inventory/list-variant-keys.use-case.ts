import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { ListVariantKeysDto, ListVariantKeysResult } from './inventory.types.js';

@injectable()
export class ListVariantKeysUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private readonly repo: IAdminInventoryRepository,
  ) {}

  execute(dto: ListVariantKeysDto): Promise<ListVariantKeysResult> {
    return this.repo.listVariantKeys(dto);
  }
}
