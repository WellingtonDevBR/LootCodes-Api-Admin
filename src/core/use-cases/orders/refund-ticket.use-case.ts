import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { RefundTicketDto, RefundTicketResult } from './order.types.js';

@injectable()
export class RefundTicketUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: RefundTicketDto): Promise<RefundTicketResult> {
    return this.orderRepo.refundTicket(dto);
  }
}
