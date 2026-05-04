import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { UC_TOKENS } from '../../di/tokens.js';
import { employeeGuard } from '../middleware/auth.guard.js';
import type { ListSecurityAuditLogUseCase } from '../../core/use-cases/security/list-security-audit-log.use-case.js';

export async function adminAuditRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as {
      action_type?: string;
      target_type?: string;
      admin_user_id?: string;
      date_from?: string;
      date_to?: string;
      limit?: string;
      offset?: string;
    };
    const uc = container.resolve<ListSecurityAuditLogUseCase>(UC_TOKENS.ListSecurityAuditLog);
    return reply.send(await uc.execute({
      action_type: query.action_type,
      target_type: query.target_type,
      admin_user_id: query.admin_user_id,
      date_from: query.date_from,
      date_to: query.date_to,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    }));
  });
}
