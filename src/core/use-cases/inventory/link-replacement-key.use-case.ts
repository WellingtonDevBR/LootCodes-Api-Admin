import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { LinkReplacementKeyDto, LinkReplacementKeyResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class LinkReplacementKeyUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: LinkReplacementKeyDto): Promise<LinkReplacementKeyResult> {
    if (!dto.original_key_id) throw new ValidationError('Original key ID is required');
    if (!dto.replacement_key_id) throw new ValidationError('Replacement key ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.linkReplacementKey(dto);
  }
}
