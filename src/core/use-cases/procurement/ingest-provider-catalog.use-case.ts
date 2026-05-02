import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { IngestProviderCatalogDto, IngestProviderCatalogResult } from './procurement.types.js';

@injectable()
export class IngestProviderCatalogUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: IngestProviderCatalogDto): Promise<IngestProviderCatalogResult> {
    return this.procurementRepo.ingestProviderCatalog(dto);
  }
}
