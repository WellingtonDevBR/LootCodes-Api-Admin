import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { UpdateAffectedKeyDto, UpdateAffectedKeyResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class UpdateAffectedKeyUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: UpdateAffectedKeyDto): Promise<UpdateAffectedKeyResult> {
    if (!dto.key_id) throw new ValidationError('Key ID is required');
    if (!dto.new_status) throw new ValidationError('New status is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.updateAffectedKey(dto);
  }
}
