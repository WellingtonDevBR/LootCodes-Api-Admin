import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { RecoverProviderOrderDto, RecoverProviderOrderResult } from './procurement.types.js';

@injectable()
export class RecoverProviderOrderUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: RecoverProviderOrderDto): Promise<RecoverProviderOrderResult> {
    return this.procurementRepo.recoverProviderOrder(dto);
  }
}
