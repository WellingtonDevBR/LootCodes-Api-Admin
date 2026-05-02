import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventorySourceRepository } from '../../ports/admin-inventory-source-repository.port.js';
import type { UnlinkVariantInventorySourceDto, UnlinkVariantInventorySourceResult } from './inventory-source.types.js';

@injectable()
export class UnlinkVariantInventorySourceUseCase {
  constructor(
    @inject(TOKENS.AdminInventorySourceRepository) private repo: IAdminInventorySourceRepository,
  ) {}

  async execute(dto: UnlinkVariantInventorySourceDto): Promise<UnlinkVariantInventorySourceResult> {
    return this.repo.unlinkVariantInventorySource(dto);
  }
}
