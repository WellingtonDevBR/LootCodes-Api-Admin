import type { FastifyInstance, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { GetComprehensiveUserDataUseCase } from '../../core/use-cases/users/get-comprehensive-user-data.use-case.js';
import type { GetUserSessionsUseCase } from '../../core/use-cases/users/get-user-sessions.use-case.js';
import type { GetUserTimelineUseCase } from '../../core/use-cases/users/get-user-timeline.use-case.js';
import type { SearchAccountProfilesUseCase } from '../../core/use-cases/users/search-account-profiles.use-case.js';
import type { BlockCustomerUseCase } from '../../core/use-cases/security/block-customer.use-case.js';
import type { ForceLogoutUseCase } from '../../core/use-cases/security/force-logout.use-case.js';

interface AuthUser {
  readonly id: string;
  readonly role: string;
}

function getAuthUser(request: FastifyRequest): AuthUser {
  return (request as FastifyRequest & { authUser: AuthUser }).authUser;
}

export async function adminUserRoutes(app: FastifyInstance) {
  app.get('/search', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { q?: string; limit?: string; offset?: string };
    const uc = container.resolve<SearchAccountProfilesUseCase>(UC_TOKENS.SearchAccountProfiles);
    const result = await uc.execute({
      query: String(query.q ?? ''),
      limit: query.limit ? Number(query.limit) : 20,
      offset: query.offset ? Number(query.offset) : 0,
    });
    return reply.send(result);
  });

  app.get('/:userId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const uc = container.resolve<GetComprehensiveUserDataUseCase>(UC_TOKENS.GetComprehensiveUserData);
    const result = await uc.execute({ user_id: userId });
    return reply.send(result);
  });

  app.get('/:userId/sessions', { preHandler: [employeeGuard] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const uc = container.resolve<GetUserSessionsUseCase>(UC_TOKENS.GetUserSessions);
    const result = await uc.execute({ user_id: userId });
    return reply.send(result);
  });

  app.get('/:userId/timeline', { preHandler: [employeeGuard] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const query = request.query as { limit?: string; offset?: string };
    const uc = container.resolve<GetUserTimelineUseCase>(UC_TOKENS.GetUserTimeline);
    const result = await uc.execute({
      user_id: userId,
      limit: query.limit ? Number(query.limit) : 50,
      offset: query.offset ? Number(query.offset) : 0,
    });
    return reply.send(result);
  });

  app.post('/:userId/block', { preHandler: [adminGuard] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = request.body as { reason?: string; email?: string; ip_address?: string };
    const authUser = getAuthUser(request);
    const uc = container.resolve<BlockCustomerUseCase>(UC_TOKENS.BlockCustomer);
    const result = await uc.execute({
      user_id: userId,
      email: body.email,
      ip_address: body.ip_address,
      admin_id: authUser.id,
      reason: body.reason ?? 'Blocked by admin',
    });
    return reply.send(result);
  });

  app.post('/:userId/unblock', { preHandler: [adminGuard] }, async (request, reply) => {
    // TODO: Wire to unblock use case when available
    const { userId } = request.params as { userId: string };
    return reply.send({ success: true, message: `Unblock for ${userId} not yet implemented` });
  });

  app.post('/:userId/force-logout', { preHandler: [adminGuard] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const authUser = getAuthUser(request);
    const uc = container.resolve<ForceLogoutUseCase>(UC_TOKENS.ForceLogout);
    const result = await uc.execute({
      user_id: userId,
      admin_id: authUser.id,
    });
    return reply.send(result);
  });

  app.post('/:userId/reset-risk', { preHandler: [adminGuard] }, async (request, reply) => {
    // TODO: Wire to reset-risk use case when available
    const { userId } = request.params as { userId: string };
    return reply.send({ success: true, message: `Risk reset for ${userId} not yet implemented` });
  });

  app.post('/generate-guest-access-link', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
