import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { ManualFulfillDto, ManualFulfillResult } from './order.types.js';

@injectable()
export class ManualFulfillUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: ManualFulfillDto): Promise<ManualFulfillResult> {
    return this.orderRepo.manualFulfill(dto);
  }
}
