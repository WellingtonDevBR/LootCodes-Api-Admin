import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { ManageProviderOfferDto, ManageProviderOfferResult } from './procurement.types.js';

@injectable()
export class ManageProviderOfferUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: ManageProviderOfferDto): Promise<ManageProviderOfferResult> {
    return this.procurementRepo.manageProviderOffer(dto);
  }
}
