import type { FastifyInstance } from 'fastify';
import { adminGuard, employeeGuard, getAuthenticatedUserId } from '../middleware/auth.guard.js';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import type { ListTicketsUseCase } from '../../core/use-cases/support/list-tickets.use-case.js';
import type { GetTicketUseCase } from '../../core/use-cases/support/get-ticket.use-case.js';
import type { UpdateTicketStatusUseCase } from '../../core/use-cases/support/update-ticket-status.use-case.js';
import type { UpdateTicketPriorityUseCase } from '../../core/use-cases/support/update-ticket-priority.use-case.js';
import type { AddTicketMessageUseCase } from '../../core/use-cases/support/add-ticket-message.use-case.js';
import type { ProcessTicketRefundUseCase } from '../../core/use-cases/support/process-ticket-refund.use-case.js';

export async function adminSupportRoutes(app: FastifyInstance) {
  // GET /api/admin/support/tickets — list tickets with filters + pagination
  app.get('/tickets', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<ListTicketsUseCase>(UC_TOKENS.ListTickets);
    const adminUserId = getAuthenticatedUserId(request);
    const query = request.query as Record<string, string | undefined>;

    const result = await uc.execute({
      search: query.search,
      status: query.status as Parameters<ListTicketsUseCase['execute']>[0]['status'],
      priority: query.priority as Parameters<ListTicketsUseCase['execute']>[0]['priority'],
      limit: query.limit ? parseInt(query.limit, 10) : 25,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
      admin_id: adminUserId,
    });

    return reply.send(result);
  });

  // GET /api/admin/support/tickets/:ticketNumber — get ticket detail
  app.get('/tickets/:ticketNumber', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetTicketUseCase>(UC_TOKENS.GetTicket);
    const adminUserId = getAuthenticatedUserId(request);
    const { ticketNumber } = request.params as { ticketNumber: string };

    const result = await uc.execute({
      ticket_number: ticketNumber,
      admin_id: adminUserId,
    });

    return reply.send(result);
  });

  // PATCH /api/admin/support/tickets/:id/status — update ticket status
  app.patch('/tickets/:id/status', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateTicketStatusUseCase>(UC_TOKENS.UpdateTicketStatus);
    const adminUserId = getAuthenticatedUserId(request);
    const { id } = request.params as { id: string };
    const body = request.body as { status: string; note?: string };

    const result = await uc.execute({
      ticket_id: id,
      status: body.status,
      admin_id: adminUserId,
      note: body.note,
    });

    return reply.send(result);
  });

  // PATCH /api/admin/support/tickets/:id/priority — update ticket priority
  app.patch('/tickets/:id/priority', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateTicketPriorityUseCase>(UC_TOKENS.UpdateTicketPriority);
    const adminUserId = getAuthenticatedUserId(request);
    const { id } = request.params as { id: string };
    const body = request.body as { priority: string };

    const result = await uc.execute({
      ticket_id: id,
      priority: body.priority,
      admin_id: adminUserId,
    });

    return reply.send(result);
  });

  // POST /api/admin/support/tickets/:id/messages — add a message to a ticket
  app.post('/tickets/:id/messages', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<AddTicketMessageUseCase>(UC_TOKENS.AddTicketMessage);
    const adminUserId = getAuthenticatedUserId(request);
    const { id } = request.params as { id: string };
    const body = request.body as {
      message: string;
      sender_name: string;
      sender_email: string;
      is_internal?: boolean;
    };

    const result = await uc.execute({
      ticket_id: id,
      message: body.message,
      sender_name: body.sender_name,
      sender_email: body.sender_email,
      is_internal: body.is_internal,
      admin_id: adminUserId,
    });

    return reply.status(201).send(result);
  });

  // POST /api/admin/support/tickets/:id/refund — process ticket refund
  app.post('/tickets/:id/refund', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<ProcessTicketRefundUseCase>(UC_TOKENS.ProcessTicketRefund);
    const adminUserId = getAuthenticatedUserId(request);
    const { id } = request.params as { id: string };
    const body = request.body as {
      order_id: string;
      refund_amount?: number;
      refund_reason?: string;
      affected_key_ids?: string[];
      mark_keys_as_faulty?: boolean;
    };

    const result = await uc.execute({
      ticket_id: id,
      order_id: body.order_id,
      refund_amount: body.refund_amount,
      refund_reason: body.refund_reason,
      affected_key_ids: body.affected_key_ids,
      mark_keys_as_faulty: body.mark_keys_as_faulty,
      admin_id: adminUserId,
    });

    return reply.send(result);
  });
}
