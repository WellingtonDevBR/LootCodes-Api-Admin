import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { SearchProvidersDto, SearchProvidersResult } from './procurement.types.js';

@injectable()
export class SearchProvidersUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: SearchProvidersDto): Promise<SearchProvidersResult> {
    return this.procurementRepo.searchProviders(dto);
  }
}
