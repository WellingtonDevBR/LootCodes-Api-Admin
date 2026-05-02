import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { RecryptProductKeysDto, RecryptProductKeysResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class RecryptProductKeysUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: RecryptProductKeysDto): Promise<RecryptProductKeysResult> {
    if (!dto.product_id) throw new ValidationError('Product ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.recryptProductKeys(dto);
  }
}
