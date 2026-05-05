import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { LinkCatalogProductDto, LinkCatalogProductResult } from './procurement.types.js';

@injectable()
export class LinkCatalogProductUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: LinkCatalogProductDto): Promise<LinkCatalogProductResult> {
    return this.procurementRepo.linkCatalogProduct(dto);
  }
}
