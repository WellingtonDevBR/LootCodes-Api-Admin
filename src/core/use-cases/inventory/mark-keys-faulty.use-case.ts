import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { MarkKeysFaultyDto, MarkKeysFaultyResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class MarkKeysFaultyUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: MarkKeysFaultyDto): Promise<MarkKeysFaultyResult> {
    if (!dto.key_ids.length) throw new ValidationError('At least one key ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    if (!dto.reason) throw new ValidationError('Reason is required');
    return this.repo.markKeysFaulty(dto);
  }
}
