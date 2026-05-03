import type {
  UpdateTicketStatusDto,
  UpdateTicketStatusResult,
  ListTicketsDto,
  ListTicketsResult,
  GetTicketDto,
  GetTicketResult,
  UpdateTicketPriorityDto,
  UpdateTicketPriorityResult,
  AddTicketMessageDto,
  AddTicketMessageResult,
  ProcessTicketRefundDto,
  ProcessTicketRefundResult,
} from '../use-cases/support/support.types.js';

export interface IAdminSupportRepository {
  listTickets(dto: ListTicketsDto): Promise<ListTicketsResult>;
  getTicket(dto: GetTicketDto): Promise<GetTicketResult>;
  updateTicketStatus(dto: UpdateTicketStatusDto): Promise<UpdateTicketStatusResult>;
  updateTicketPriority(dto: UpdateTicketPriorityDto): Promise<UpdateTicketPriorityResult>;
  addTicketMessage(dto: AddTicketMessageDto): Promise<AddTicketMessageResult>;
  processTicketRefund(dto: ProcessTicketRefundDto): Promise<ProcessTicketRefundResult>;
}
