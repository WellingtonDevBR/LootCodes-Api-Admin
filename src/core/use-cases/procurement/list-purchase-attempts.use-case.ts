import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { ListPurchaseAttemptsDto, ListPurchaseAttemptsResult } from './procurement.types.js';

@injectable()
export class ListPurchaseAttemptsUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private repo: IAdminProcurementRepository,
  ) {}

  async execute(dto: ListPurchaseAttemptsDto): Promise<ListPurchaseAttemptsResult> {
    return this.repo.listPurchaseAttempts(dto);
  }
}
