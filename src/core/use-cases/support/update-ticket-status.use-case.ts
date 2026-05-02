import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSupportRepository } from '../../ports/admin-support-repository.port.js';
import type { UpdateTicketStatusDto, UpdateTicketStatusResult } from './support.types.js';

@injectable()
export class UpdateTicketStatusUseCase {
  constructor(
    @inject(TOKENS.AdminSupportRepository) private supportRepo: IAdminSupportRepository,
  ) {}

  async execute(dto: UpdateTicketStatusDto): Promise<UpdateTicketStatusResult> {
    return this.supportRepo.updateTicketStatus(dto);
  }
}
