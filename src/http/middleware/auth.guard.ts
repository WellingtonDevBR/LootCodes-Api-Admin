import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IAuthProvider } from '../../core/ports/auth.port.js';
import type { IAdminRoleChecker } from '../../core/ports/admin-role.port.js';

export async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthUser(request, reply);
  if (!user) return;

  const roleChecker = container.resolve<IAdminRoleChecker>(TOKENS.AdminRoleChecker);
  const isAdmin = await roleChecker.isAdmin(user.id);
  if (!isAdmin) {
    return reply.code(403).send({ error: 'Admin access required', code: 'FORBIDDEN' });
  }
}

export async function employeeGuard(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthUser(request, reply);
  if (!user) return;

  const roleChecker = container.resolve<IAdminRoleChecker>(TOKENS.AdminRoleChecker);
  const allowed = await roleChecker.isAdminOrEmployee(user.id);
  if (!allowed) {
    return reply.code(403).send({ error: 'Admin or employee access required', code: 'FORBIDDEN' });
  }
}

export async function internalSecretGuard(request: FastifyRequest, reply: FastifyReply) {
  const secret = request.headers['x-internal-secret'] as string | undefined;
  if (!secret) {
    return reply.code(401).send({ error: 'Missing internal secret', code: 'AUTHENTICATION_ERROR' });
  }

  const { getEnv } = await import('../../config/env.js');
  const env = getEnv();

  const validSecrets = [env.INTERNAL_SERVICE_SECRET];
  if (env.INTERNAL_SERVICE_SECRET_PREVIOUS) {
    validSecrets.push(env.INTERNAL_SERVICE_SECRET_PREVIOUS);
  }

  if (!validSecrets.includes(secret)) {
    return reply.code(401).send({ error: 'Invalid internal secret', code: 'AUTHENTICATION_ERROR' });
  }

  (request as unknown as Record<string, unknown>).authUser = { id: 'internal', role: 'service' };
}

async function resolveAuthUser(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid authorization header' });
    return null;
  }

  const token = authHeader.slice(7);
  const authProvider = container.resolve<IAuthProvider>(TOKENS.AuthProvider);
  const user = await authProvider.getUserByToken(token);

  if (!user) {
    reply.code(401).send({ error: 'Invalid or expired token' });
    return null;
  }

  (request as unknown as Record<string, unknown>).authUser = user;
  return user;
}
