import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { BulkBurnKeysDto, BulkBurnKeysResult } from './inventory.types.js';

@injectable()
export class BulkBurnKeysUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private readonly repo: IAdminInventoryRepository,
  ) {}

  execute(dto: BulkBurnKeysDto): Promise<BulkBurnKeysResult> {
    return this.repo.bulkBurnAvailableKeys(dto);
  }
}
