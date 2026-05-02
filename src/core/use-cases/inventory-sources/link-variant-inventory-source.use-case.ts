import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventorySourceRepository } from '../../ports/admin-inventory-source-repository.port.js';
import type { LinkVariantInventorySourceDto, LinkVariantInventorySourceResult } from './inventory-source.types.js';

@injectable()
export class LinkVariantInventorySourceUseCase {
  constructor(
    @inject(TOKENS.AdminInventorySourceRepository) private repo: IAdminInventorySourceRepository,
  ) {}

  async execute(dto: LinkVariantInventorySourceDto): Promise<LinkVariantInventorySourceResult> {
    return this.repo.linkVariantInventorySource(dto);
  }
}
