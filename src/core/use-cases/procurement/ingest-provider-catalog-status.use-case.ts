import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { IngestProviderCatalogStatusDto, IngestProviderCatalogStatusResult } from './procurement.types.js';

@injectable()
export class IngestProviderCatalogStatusUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: IngestProviderCatalogStatusDto): Promise<IngestProviderCatalogStatusResult> {
    return this.procurementRepo.ingestProviderCatalogStatus(dto);
  }
}
