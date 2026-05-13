import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IAuthProvider } from '../../core/ports/auth.port.js';
import type { IAdminRoleChecker } from '../../core/ports/admin-role.port.js';

/** Short-lived in-process cache: token → { user, isAdmin, isEmployee, expiresAt } */
const AUTH_CACHE_TTL_MS = 30_000;

interface AuthCacheEntry {
  user: { id: string; [k: string]: unknown };
  isAdmin: boolean;
  isEmployee: boolean;
  expiresAt: number;
}

const authCache = new Map<string, AuthCacheEntry>();

function pruneAuthCache(): void {
  const now = Date.now();
  for (const [token, entry] of authCache) {
    if (entry.expiresAt <= now) authCache.delete(token);
  }
}

/**
 * User id from JWT after {@link adminGuard} / {@link employeeGuard} (stored as `authUser`).
 * Procurement and several routes mistakenly read `adminUserId`, which is never set.
 */
export function getAuthenticatedUserId(request: FastifyRequest): string {
  const authUser = (request as unknown as Record<string, unknown>).authUser as { id?: string } | undefined;
  const id = authUser?.id;
  return typeof id === 'string' && id.length > 0 ? id : 'unknown';
}

export async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  const entry = await resolveAuthEntry(request, reply);
  if (!entry) return;
  if (!entry.isAdmin) {
    return reply.code(403).send({ error: 'Admin access required', code: 'FORBIDDEN' });
  }
}

export async function employeeGuard(request: FastifyRequest, reply: FastifyReply) {
  const entry = await resolveAuthEntry(request, reply);
  if (!entry) return;
  if (!entry.isEmployee) {
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

async function resolveAuthEntry(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthCacheEntry | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid authorization header' });
    return null;
  }

  const token = authHeader.slice(7);

  // Fast path: serve from cache
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    (request as unknown as Record<string, unknown>).authUser = cached.user;
    return cached;
  }

  // Slow path: verify token + check roles in parallel where possible
  const authProvider = container.resolve<IAuthProvider>(TOKENS.AuthProvider);
  const user = await authProvider.getUserByToken(token);

  if (!user) {
    reply.code(401).send({ error: 'Invalid or expired token' });
    return null;
  }

  const roleChecker = container.resolve<IAdminRoleChecker>(TOKENS.AdminRoleChecker);
  const [isAdmin, isEmployee] = await Promise.all([
    roleChecker.isAdmin(user.id),
    roleChecker.isAdminOrEmployee(user.id),
  ]);

  const entry: AuthCacheEntry = {
    user: user as { id: string; [k: string]: unknown },
    isAdmin,
    isEmployee,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  };

  pruneAuthCache();
  authCache.set(token, entry);
  (request as unknown as Record<string, unknown>).authUser = user;
  return entry;
}
