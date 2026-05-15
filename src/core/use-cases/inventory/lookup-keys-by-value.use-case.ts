import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type {
  LookupKeysByValueDto,
  LookupKeysByValueResult,
} from './inventory.types.js';

@injectable()
export class LookupKeysByValueUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private readonly repo: IAdminInventoryRepository,
  ) {}

  execute(dto: LookupKeysByValueDto): Promise<LookupKeysByValueResult> {
    return this.repo.lookupKeysByValue(dto);
  }
}
