import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { employeeGuard } from '../middleware/auth.guard.js';
import type { ListAlertsUseCase } from '../../core/use-cases/alerts/list-alerts.use-case.js';
import type { DismissAlertUseCase } from '../../core/use-cases/alerts/dismiss-alert.use-case.js';
import type { DismissAllAlertsUseCase } from '../../core/use-cases/alerts/dismiss-all-alerts.use-case.js';

export async function adminAlertsRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const uc = container.resolve<ListAlertsUseCase>(UC_TOKENS.ListAlerts);

    const result = await uc.execute({
      is_read: query.is_read === 'true' ? true : query.is_read === 'false' ? false : undefined,
      is_resolved: query.is_resolved === 'true' ? true : query.is_resolved === 'false' ? false : undefined,
      severity: query.severity,
      alert_type: query.alert_type,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });

    return reply.send(result);
  });

  app.patch('/:id/dismiss', { preHandler: [employeeGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const uc = container.resolve<DismissAlertUseCase>(UC_TOKENS.DismissAlert);
    await uc.execute({ id });
    return reply.send({ success: true });
  });

  app.post('/dismiss-all', { preHandler: [employeeGuard] }, async (request, reply) => {
    const body = request.body as { ids?: string[] } | undefined;
    const ids = body?.ids ?? [];
    if (ids.length === 0) {
      return reply.status(400).send({ error: 'ids array is required' });
    }
    const uc = container.resolve<DismissAllAlertsUseCase>(UC_TOKENS.DismissAllAlerts);
    await uc.execute({ ids });
    return reply.send({ success: true });
  });
}
