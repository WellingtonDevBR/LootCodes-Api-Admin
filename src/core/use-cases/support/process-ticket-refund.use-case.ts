import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSupportRepository } from '../../ports/admin-support-repository.port.js';
import type { ProcessTicketRefundDto, ProcessTicketRefundResult } from './support.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class ProcessTicketRefundUseCase {
  constructor(
    @inject(TOKENS.AdminSupportRepository) private supportRepo: IAdminSupportRepository,
  ) {}

  async execute(dto: ProcessTicketRefundDto): Promise<ProcessTicketRefundResult> {
    if (!dto.ticket_id) throw new ValidationError('Ticket ID is required');
    if (!dto.order_id) throw new ValidationError('Order ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');

    return this.supportRepo.processTicketRefund(dto);
  }
}
