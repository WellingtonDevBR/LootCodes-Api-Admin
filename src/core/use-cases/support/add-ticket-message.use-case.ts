import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSupportRepository } from '../../ports/admin-support-repository.port.js';
import type { AddTicketMessageDto, AddTicketMessageResult } from './support.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class AddTicketMessageUseCase {
  constructor(
    @inject(TOKENS.AdminSupportRepository) private supportRepo: IAdminSupportRepository,
  ) {}

  async execute(dto: AddTicketMessageDto): Promise<AddTicketMessageResult> {
    if (!dto.ticket_id) throw new ValidationError('Ticket ID is required');
    if (!dto.message?.trim()) throw new ValidationError('Message is required');
    if (!dto.sender_name) throw new ValidationError('Sender name is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');

    return this.supportRepo.addTicketMessage(dto);
  }
}
