import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { RefundInitiateDto, RefundInitiateResult } from './order.types.js';

@injectable()
export class RefundInitiateUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: RefundInitiateDto): Promise<RefundInitiateResult> {
    return this.orderRepo.refundInitiate(dto);
  }
}
