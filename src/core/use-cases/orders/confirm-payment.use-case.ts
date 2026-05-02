import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { ConfirmPaymentDto, ConfirmPaymentResult } from './order.types.js';

@injectable()
export class ConfirmPaymentUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: ConfirmPaymentDto): Promise<ConfirmPaymentResult> {
    return this.orderRepo.confirmPayment(dto);
  }
}
