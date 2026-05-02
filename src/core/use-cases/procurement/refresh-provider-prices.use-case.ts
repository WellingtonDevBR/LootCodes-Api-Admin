import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { RefreshProviderPricesDto, RefreshProviderPricesResult } from './procurement.types.js';

@injectable()
export class RefreshProviderPricesUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: RefreshProviderPricesDto): Promise<RefreshProviderPricesResult> {
    return this.procurementRepo.refreshProviderPrices(dto);
  }
}
