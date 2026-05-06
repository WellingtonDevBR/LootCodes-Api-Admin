import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { ListPurchaseQueueDto, ListPurchaseQueueResult } from './procurement.types.js';

@injectable()
export class ListPurchaseQueueUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private repo: IAdminProcurementRepository,
  ) {}

  async execute(dto: ListPurchaseQueueDto): Promise<ListPurchaseQueueResult> {
    return this.repo.listPurchaseQueue(dto);
  }
}
