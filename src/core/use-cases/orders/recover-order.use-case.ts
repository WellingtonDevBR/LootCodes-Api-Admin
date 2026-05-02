import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { RecoverOrderDto, RecoverOrderResult } from './order.types.js';

@injectable()
export class RecoverOrderUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: RecoverOrderDto): Promise<RecoverOrderResult> {
    return this.orderRepo.recoverOrder(dto);
  }
}
