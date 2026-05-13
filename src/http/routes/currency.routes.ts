import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { GetCurrencyRatesUseCase } from '../../core/use-cases/currency/get-currency-rates.use-case.js';
import type { AddCurrencyRateUseCase } from '../../core/use-cases/currency/add-currency-rate.use-case.js';
import type { UpdateCurrencyRateUseCase } from '../../core/use-cases/currency/update-currency-manual.use-case.js';
import type { UpdateCurrencyMarginUseCase } from '../../core/use-cases/currency/update-currency-margin.use-case.js';
import type { ToggleCurrencyActiveUseCase } from '../../core/use-cases/currency/toggle-currency-active.use-case.js';
import type { DeleteCurrencyRateUseCase } from '../../core/use-cases/currency/delete-currency-rate.use-case.js';
import type { SyncCurrencyUseCase } from '../../core/use-cases/currency/sync-currency.use-case.js';
import type { GenerateAllPricesUseCase } from '../../core/use-cases/currency/generate-all-prices.use-case.js';

interface IdParams { id: string }

export async function adminCurrencyRoutes(app: FastifyInstance) {

  // ── List all currency rates ───────────────────────────────────────
  app.get('/rates', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const uc = container.resolve<GetCurrencyRatesUseCase>(UC_TOKENS.GetCurrencyRates);
    const rates = await uc.execute();
    // Rates change infrequently; 60s is acceptable staleness for the CRM.
    reply.header('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    return reply.send({ rates });
  });

  // ── Add a new currency rate ───────────────────────────────────────
  app.post<{ Body: { to_currency: string; rate: number } }>(
    '/rates',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const authUser = (request as unknown as Record<string, unknown>).authUser as { id: string };
      const uc = container.resolve<AddCurrencyRateUseCase>(UC_TOKENS.AddCurrencyRate);
      const created = await uc.execute({
        to_currency: request.body.to_currency,
        rate: request.body.rate,
        admin_id: authUser.id,
      });
      return reply.status(201).send(created);
    },
  );

  // ── Update exchange rate ──────────────────────────────────────────
  app.put<{ Params: IdParams; Body: { rate: number } }>(
    '/rates/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const authUser = (request as unknown as Record<string, unknown>).authUser as { id: string };
      const uc = container.resolve<UpdateCurrencyRateUseCase>(UC_TOKENS.UpdateCurrencyRate);
      await uc.execute({
        id: request.params.id,
        rate: request.body.rate,
        admin_id: authUser.id,
      });
      return reply.send({ success: true });
    },
  );

  // ── Update margin percentage ──────────────────────────────────────
  app.put<{ Params: IdParams; Body: { margin_pct: number } }>(
    '/rates/:id/margin',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const authUser = (request as unknown as Record<string, unknown>).authUser as { id: string };
      const uc = container.resolve<UpdateCurrencyMarginUseCase>(UC_TOKENS.UpdateCurrencyMargin);
      await uc.execute({
        id: request.params.id,
        margin_pct: request.body.margin_pct,
        admin_id: authUser.id,
      });
      return reply.send({ success: true });
    },
  );

  // ── Toggle active/inactive ────────────────────────────────────────
  app.put<{ Params: IdParams }>(
    '/rates/:id/toggle',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const authUser = (request as unknown as Record<string, unknown>).authUser as { id: string };
      const uc = container.resolve<ToggleCurrencyActiveUseCase>(UC_TOKENS.ToggleCurrencyActive);
      const is_active = await uc.execute({
        id: request.params.id,
        admin_id: authUser.id,
      });
      return reply.send({ is_active });
    },
  );

  // ── Delete a currency rate ────────────────────────────────────────
  app.delete<{ Params: IdParams }>(
    '/rates/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const authUser = (request as unknown as Record<string, unknown>).authUser as { id: string };
      const uc = container.resolve<DeleteCurrencyRateUseCase>(UC_TOKENS.DeleteCurrencyRate);
      await uc.execute({
        id: request.params.id,
        admin_id: authUser.id,
      });
      return reply.status(204).send();
    },
  );

  // ── Sync rates from external source ───────────────────────────────
  app.post('/sync', { preHandler: [adminGuard] }, async (request, reply) => {
    const authUser = (request as unknown as Record<string, unknown>).authUser as { id: string };
    const uc = container.resolve<SyncCurrencyUseCase>(UC_TOKENS.SyncCurrency);
    const result = await uc.execute({ admin_id: authUser.id });
    return reply.send(result);
  });

  // ── Generate all localized prices ─────────────────────────────────
  app.post('/generate-prices', { preHandler: [adminGuard] }, async (request, reply) => {
    const authUser = (request as unknown as Record<string, unknown>).authUser as { id: string };
    const uc = container.resolve<GenerateAllPricesUseCase>(UC_TOKENS.GenerateAllPrices);
    const result = await uc.execute({ admin_id: authUser.id });
    return reply.send(result);
  });
}
