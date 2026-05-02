import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';

@injectable()
export class GetOrderDetailUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(orderId: string): Promise<unknown> {
    return this.orderRepo.getOrderDetail(orderId);
  }
}
