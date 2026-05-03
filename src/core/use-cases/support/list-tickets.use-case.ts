import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSupportRepository } from '../../ports/admin-support-repository.port.js';
import type { ListTicketsDto, ListTicketsResult } from './support.types.js';

@injectable()
export class ListTicketsUseCase {
  constructor(
    @inject(TOKENS.AdminSupportRepository) private supportRepo: IAdminSupportRepository,
  ) {}

  async execute(dto: ListTicketsDto): Promise<ListTicketsResult> {
    return this.supportRepo.listTickets(dto);
  }
}
