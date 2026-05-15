import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { ListKeysDto, ListKeysResult } from './inventory.types.js';

@injectable()
export class ListKeysUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private readonly repo: IAdminInventoryRepository,
  ) {}

  execute(dto: ListKeysDto): Promise<ListKeysResult> {
    return this.repo.listKeys(dto);
  }
}
