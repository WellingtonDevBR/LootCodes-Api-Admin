import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { FixKeyStatesDto, FixKeyStatesResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class FixKeyStatesUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: FixKeyStatesDto): Promise<FixKeyStatesResult> {
    if (!dto.variant_id) throw new ValidationError('Variant ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.fixKeyStates(dto);
  }
}
