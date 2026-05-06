import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard } from '../middleware/auth.guard.js';
import type { DigisellerReconcileProfitUseCase } from '../../core/use-cases/digiseller/reconcile-profit.use-case.js';
import type { DigisellerReconcileProfitDto } from '../../core/use-cases/digiseller/digiseller.types.js';

interface ReconcileBody {
  transaction_id?: string;
  invoice_id?: string;
  all_missing?: boolean;
  limit?: number;
  since?: string;
  dry_run?: boolean;
}

export async function adminDigisellerRoutes(app: FastifyInstance) {
  app.post('/reconcile-profit', {
    preHandler: [adminGuard],
  }, async (request, reply) => {
    const body = (request.body ?? {}) as ReconcileBody;

    const dto: DigisellerReconcileProfitDto = {
      transaction_id: body.transaction_id,
      invoice_id: body.invoice_id,
      all_missing: body.all_missing,
      limit: body.limit,
      since: body.since,
      dry_run: body.dry_run,
      admin_id: ((request as unknown as Record<string, { id?: string }>).authUser?.id) ?? 'unknown',
    };

    const uc = container.resolve<DigisellerReconcileProfitUseCase>(UC_TOKENS.DigisellerReconcileProfit);
    const result = await uc.execute(dto);
    return reply.send(result);
  });
}
