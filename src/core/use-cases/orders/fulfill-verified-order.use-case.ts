import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { FulfillVerifiedOrderDto, FulfillVerifiedOrderResult } from './order.types.js';

@injectable()
export class FulfillVerifiedOrderUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: FulfillVerifiedOrderDto): Promise<FulfillVerifiedOrderResult> {
    return this.orderRepo.fulfillVerifiedOrder(dto);
  }
}
