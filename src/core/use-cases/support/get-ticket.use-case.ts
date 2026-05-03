import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSupportRepository } from '../../ports/admin-support-repository.port.js';
import type { GetTicketDto, GetTicketResult } from './support.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class GetTicketUseCase {
  constructor(
    @inject(TOKENS.AdminSupportRepository) private supportRepo: IAdminSupportRepository,
  ) {}

  async execute(dto: GetTicketDto): Promise<GetTicketResult> {
    if (!dto.ticket_number) throw new ValidationError('Ticket number is required');

    return this.supportRepo.getTicket(dto);
  }
}
