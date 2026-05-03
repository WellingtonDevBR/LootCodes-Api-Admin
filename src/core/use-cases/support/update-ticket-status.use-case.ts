import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSupportRepository } from '../../ports/admin-support-repository.port.js';
import type { UpdateTicketStatusDto, UpdateTicketStatusResult } from './support.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

const VALID_STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];

@injectable()
export class UpdateTicketStatusUseCase {
  constructor(
    @inject(TOKENS.AdminSupportRepository) private supportRepo: IAdminSupportRepository,
  ) {}

  async execute(dto: UpdateTicketStatusDto): Promise<UpdateTicketStatusResult> {
    if (!dto.ticket_id) throw new ValidationError('Ticket ID is required');
    if (!dto.status) throw new ValidationError('Status is required');
    if (!VALID_STATUSES.includes(dto.status)) throw new ValidationError(`Invalid status: ${dto.status}`);
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');

    return this.supportRepo.updateTicketStatus(dto);
  }
}
