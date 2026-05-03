import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminSupportRepository } from '../../core/ports/admin-support-repository.port.js';
import type {
  ListTicketsDto,
  ListTicketsResult,
  AdminTicketRow,
  TicketStats,
  GetTicketDto,
  GetTicketResult,
  SupportTicketDetail,
  TicketMessageRow,
  TicketAffectedKeyRow,
  TicketOrderInfo,
  UpdateTicketStatusDto,
  UpdateTicketStatusResult,
  UpdateTicketPriorityDto,
  UpdateTicketPriorityResult,
  AddTicketMessageDto,
  AddTicketMessageResult,
  ProcessTicketRefundDto,
  ProcessTicketRefundResult,
} from '../../core/use-cases/support/support.types.js';
import { NotFoundError } from '../../core/errors/domain-errors.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminSupportRepository');

const LIST_COLUMNS = [
  'id', 'ticket_number', 'ticket_type', 'subject', 'status', 'priority',
  'customer_name', 'customer_email', 'guest_email', 'source', 'source_channel',
  'user_id', 'created_at', 'updated_at', 'resolved_at', 'customer_feedback_rating',
].join(',');

@injectable()
export class SupabaseAdminSupportRepository implements IAdminSupportRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async listTickets(dto: ListTicketsDto): Promise<ListTicketsResult> {
    logger.info('Listing tickets', { status: dto.status, priority: dto.priority, search: dto.search });

    const filters: Record<string, unknown> = {};
    if (dto.status) filters.status = dto.status;
    if (dto.priority) filters.priority = dto.priority;

    const tickets = await this.db.query<AdminTicketRow>('support_tickets', {
      select: LIST_COLUMNS,
      filter: Object.keys(filters).length > 0 ? filters : undefined,
      order: { column: 'created_at', ascending: false },
      limit: dto.limit,
    });

    const stats = await this.computeStats();

    const total = dto.status || dto.priority
      ? tickets.length
      : stats.total;

    return { tickets, total, stats };
  }

  async getTicket(dto: GetTicketDto): Promise<GetTicketResult> {
    logger.info('Getting ticket detail', { ticketNumber: dto.ticket_number });

    const ticket = await this.db.queryOne<Record<string, unknown>>('support_tickets', {
      filter: { ticket_number: dto.ticket_number },
    });

    if (!ticket) {
      throw new NotFoundError(`Ticket ${dto.ticket_number} not found`);
    }

    const ticketId = ticket.id as string;

    const [messages, affectedKeys] = await Promise.all([
      this.db.query<TicketMessageRow>('ticket_messages', {
        filter: { ticket_id: ticketId },
        order: { column: 'created_at', ascending: true },
      }),
      this.db.query<TicketAffectedKeyRow>('ticket_affected_keys', {
        filter: { ticket_id: ticketId },
        order: { column: 'created_at', ascending: true },
      }),
    ]);

    let order: TicketOrderInfo | undefined;
    if (ticket.order_id) {
      const orderRow = await this.db.queryOne<Record<string, unknown>>('orders', {
        select: 'order_number,status,order_channel,contact_email,delivery_email,guest_email,fulfillment_status,refund_status,refunded_at,refund_amount,refund_reason,total_amount,currency',
        filter: { id: ticket.order_id },
      });
      if (orderRow) {
        order = orderRow as unknown as TicketOrderInfo;
      }
    }

    const detail: SupportTicketDetail = {
      id: ticketId,
      ticket_number: ticket.ticket_number as string,
      user_id: ticket.user_id as string | undefined,
      guest_email: ticket.guest_email as string | undefined,
      customer_email: ticket.customer_email as string | undefined,
      order_contact_email: ticket.order_contact_email as string | undefined,
      customer_name: ticket.customer_name as string | undefined,
      source: ticket.source as string | undefined,
      source_channel: ticket.source_channel as string | undefined,
      subject: ticket.subject as string,
      description: ticket.description as string,
      ticket_type: ticket.ticket_type as SupportTicketDetail['ticket_type'],
      status: ticket.status as SupportTicketDetail['status'],
      priority: ticket.priority as SupportTicketDetail['priority'],
      order_id: ticket.order_id as string | undefined,
      order,
      order_item_id: ticket.order_item_id as string | undefined,
      product_key_id: ticket.product_key_id as string | undefined,
      issue_context: ticket.issue_context as Record<string, unknown> | undefined,
      assigned_to: ticket.assigned_to as string | undefined,
      created_at: ticket.created_at as string,
      updated_at: ticket.updated_at as string,
      resolved_at: ticket.resolved_at as string | undefined,
      first_response_at: ticket.first_response_at as string | undefined,
      customer_feedback_rating: ticket.customer_feedback_rating as number | undefined,
      customer_feedback_at: ticket.customer_feedback_at as string | undefined,
      metadata: ticket.metadata as Record<string, unknown> | undefined,
      messages,
      affected_keys: affectedKeys,
    };

    return { ticket: detail };
  }

  async updateTicketStatus(dto: UpdateTicketStatusDto): Promise<UpdateTicketStatusResult> {
    logger.info('Updating ticket status', { ticketId: dto.ticket_id, status: dto.status, adminId: dto.admin_id });

    const updateData: Record<string, unknown> = {
      status: dto.status,
      updated_by: dto.admin_id,
      updated_at: new Date().toISOString(),
    };

    if (dto.status === 'resolved') {
      updateData.resolved_at = new Date().toISOString();
    }

    if (dto.note) {
      updateData.admin_note = dto.note;
    }

    await this.db.update('support_tickets', { id: dto.ticket_id }, updateData);

    return { success: true };
  }

  async updateTicketPriority(dto: UpdateTicketPriorityDto): Promise<UpdateTicketPriorityResult> {
    logger.info('Updating ticket priority', { ticketId: dto.ticket_id, priority: dto.priority, adminId: dto.admin_id });

    await this.db.update('support_tickets', { id: dto.ticket_id }, {
      priority: dto.priority,
      updated_by: dto.admin_id,
      updated_at: new Date().toISOString(),
    });

    return { success: true };
  }

  async addTicketMessage(dto: AddTicketMessageDto): Promise<AddTicketMessageResult> {
    logger.info('Adding ticket message', { ticketId: dto.ticket_id, adminId: dto.admin_id });

    const result = await this.db.insert<{ id: string }>('ticket_messages', {
      ticket_id: dto.ticket_id,
      sender_type: 'admin',
      sender_id: dto.admin_id,
      sender_email: dto.sender_email,
      sender_name: dto.sender_name,
      message: dto.message,
      is_internal: dto.is_internal ?? false,
      created_at: new Date().toISOString(),
    });

    await this.db.update('support_tickets', { id: dto.ticket_id }, {
      updated_at: new Date().toISOString(),
    });

    return { success: true, message_id: result.id };
  }

  async processTicketRefund(dto: ProcessTicketRefundDto): Promise<ProcessTicketRefundResult> {
    logger.info('Processing ticket refund', { ticketId: dto.ticket_id, orderId: dto.order_id, adminId: dto.admin_id });

    await this.db.rpc('process_ticket_refund_v2', {
      p_ticket_id: dto.ticket_id,
      p_order_id: dto.order_id,
      p_admin_id: dto.admin_id,
      p_refund_amount: dto.refund_amount ?? null,
      p_refund_reason: dto.refund_reason ?? null,
      p_affected_key_ids: dto.affected_key_ids ?? null,
      p_mark_keys_as_faulty: dto.mark_keys_as_faulty ?? false,
    });

    return { success: true };
  }

  private async computeStats(): Promise<TicketStats> {
    const allTickets = await this.db.query<{ status: string; priority: string }>('support_tickets', {
      select: 'status,priority',
    });

    let open = 0;
    let inProgress = 0;
    let urgent = 0;

    for (const t of allTickets) {
      if (t.status === 'open') open++;
      if (t.status === 'in_progress') inProgress++;
      if (t.priority === 'urgent' && t.status !== 'resolved' && t.status !== 'closed') urgent++;
    }

    return { open, in_progress: inProgress, urgent, total: allTickets.length };
  }
}
