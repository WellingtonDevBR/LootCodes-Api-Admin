import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard, internalSecretGuard } from '../middleware/auth.guard.js';
import type { GetCurrencyRatesUseCase } from '../../core/use-cases/currency/get-currency-rates.use-case.js';

export async function adminCurrencyRoutes(app: FastifyInstance) {
  app.post('/sync', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.put('/rates', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.get('/rates', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const uc = container.resolve<GetCurrencyRatesUseCase>(UC_TOKENS.GetCurrencyRates);
    const result = await uc.execute();
    return reply.send(result);
  });

  app.post('/sync-internal', { preHandler: [internalSecretGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
