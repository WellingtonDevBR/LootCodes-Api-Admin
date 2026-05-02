import type {
  UpdateTicketStatusDto,
  UpdateTicketStatusResult,
} from '../use-cases/support/support.types.js';

export interface IAdminSupportRepository {
  updateTicketStatus(dto: UpdateTicketStatusDto): Promise<UpdateTicketStatusResult>;
}
