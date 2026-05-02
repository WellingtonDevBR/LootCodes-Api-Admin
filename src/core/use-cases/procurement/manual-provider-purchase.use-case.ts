import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { ManualProviderPurchaseDto, ManualProviderPurchaseResult } from './procurement.types.js';

@injectable()
export class ManualProviderPurchaseUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: ManualProviderPurchaseDto): Promise<ManualProviderPurchaseResult> {
    return this.procurementRepo.manualProviderPurchase(dto);
  }
}
