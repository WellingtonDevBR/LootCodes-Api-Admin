import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { SearchCatalogDto, SearchCatalogResult } from './procurement.types.js';

@injectable()
export class SearchCatalogUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: SearchCatalogDto): Promise<SearchCatalogResult> {
    return this.procurementRepo.searchCatalog(dto);
  }
}
