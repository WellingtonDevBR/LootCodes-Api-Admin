import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { ReplaceKeyDto, ReplaceKeyResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class ReplaceKeyUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: ReplaceKeyDto): Promise<ReplaceKeyResult> {
    if (!dto.order_item_id) throw new ValidationError('Order item ID is required');
    if (!dto.old_key_id) throw new ValidationError('Old key ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.replaceKey(dto);
  }
}
