import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSupportRepository } from '../../ports/admin-support-repository.port.js';
import type { UpdateTicketPriorityDto, UpdateTicketPriorityResult } from './support.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

@injectable()
export class UpdateTicketPriorityUseCase {
  constructor(
    @inject(TOKENS.AdminSupportRepository) private supportRepo: IAdminSupportRepository,
  ) {}

  async execute(dto: UpdateTicketPriorityDto): Promise<UpdateTicketPriorityResult> {
    if (!dto.ticket_id) throw new ValidationError('Ticket ID is required');
    if (!dto.priority) throw new ValidationError('Priority is required');
    if (!VALID_PRIORITIES.includes(dto.priority)) throw new ValidationError(`Invalid priority: ${dto.priority}`);
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');

    return this.supportRepo.updateTicketPriority(dto);
  }
}
