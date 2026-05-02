import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { RefundOrderDto, RefundOrderResult } from './order.types.js';

@injectable()
export class RefundOrderUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: RefundOrderDto): Promise<RefundOrderResult> {
    return this.orderRepo.refundOrder(dto);
  }
}
