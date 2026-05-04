import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { GetSecurityConfigsUseCase } from '../../core/use-cases/security/get-security-configs.use-case.js';
import type { UpdateSecurityConfigUseCase } from '../../core/use-cases/security/update-security-config.use-case.js';
import type { UnlockRateLimitUseCase } from '../../core/use-cases/security/unlock-rate-limit.use-case.js';
import type { DirectUnlockRateLimitUseCase } from '../../core/use-cases/security/direct-unlock-rate-limit.use-case.js';
import type { BlockCustomerUseCase } from '../../core/use-cases/security/block-customer.use-case.js';
import type { ForceLogoutUseCase } from '../../core/use-cases/security/force-logout.use-case.js';
import type { ListRateLimitViolationsUseCase } from '../../core/use-cases/security/list-rate-limit-violations.use-case.js';
import type { ListRateLimitUnlocksUseCase } from '../../core/use-cases/security/list-rate-limit-unlocks.use-case.js';
import type { ListIpBlocklistUseCase } from '../../core/use-cases/security/list-ip-blocklist.use-case.js';
import type { AddIpBlockUseCase } from '../../core/use-cases/security/add-ip-block.use-case.js';
import type { RemoveIpBlockUseCase } from '../../core/use-cases/security/remove-ip-block.use-case.js';
import type { ListCustomerBlocklistUseCase } from '../../core/use-cases/security/list-customer-blocklist.use-case.js';
import type { RemoveCustomerBlockUseCase } from '../../core/use-cases/security/remove-customer-block.use-case.js';
import type { GetSurgeStateUseCase } from '../../core/use-cases/security/get-surge-state.use-case.js';
import type { GetPlatformSecuritySettingUseCase } from '../../core/use-cases/security/get-platform-security-setting.use-case.js';
import type { UpdatePlatformSecuritySettingUseCase } from '../../core/use-cases/security/update-platform-security-setting.use-case.js';
import type { ListSecurityAuditLogUseCase } from '../../core/use-cases/security/list-security-audit-log.use-case.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getAuthUser(request: unknown): { id: string } {
  return (request as Record<string, unknown>).authUser as { id: string };
}

export async function adminSecurityRoutes(app: FastifyInstance) {

  // ── Security Configs ─────────────────────────────────────────────

  app.get('/configs', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const uc = container.resolve<GetSecurityConfigsUseCase>(UC_TOKENS.GetSecurityConfigs);
    return reply.send(await uc.execute());
  });

  app.put<{ Body: { key: string; value: unknown } }>(
    '/configs',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { key, value } = request.body;
      if (!key) return reply.code(400).send({ error: 'key is required' });
      const authUser = getAuthUser(request);
      const uc = container.resolve<UpdateSecurityConfigUseCase>(UC_TOKENS.UpdateSecurityConfig);
      return reply.send(await uc.execute({ key, value, admin_id: authUser.id }));
    },
  );

  // ── Rate Limits ──────────────────────────────────────────────────

  app.post<{ Body: { identifier: string; sms_code?: string } }>(
    '/rate-limit/unlock',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { identifier, sms_code } = request.body;
      if (!identifier) return reply.code(400).send({ error: 'identifier is required' });
      const authUser = getAuthUser(request);
      const uc = container.resolve<UnlockRateLimitUseCase>(UC_TOKENS.UnlockRateLimit);
      return reply.send(await uc.execute({ identifier, admin_id: authUser.id, sms_code }));
    },
  );

  app.post<{ Body: { identifier: string } }>(
    '/rate-limit/direct-unlock',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { identifier } = request.body;
      if (!identifier) return reply.code(400).send({ error: 'identifier is required' });
      const authUser = getAuthUser(request);
      const uc = container.resolve<DirectUnlockRateLimitUseCase>(UC_TOKENS.DirectUnlockRateLimit);
      return reply.send(await uc.execute({ identifier, admin_id: authUser.id }));
    },
  );

  app.get('/rate-limit/violations', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { identifier?: string; identifier_type?: string; limit?: string; offset?: string };
    const uc = container.resolve<ListRateLimitViolationsUseCase>(UC_TOKENS.ListRateLimitViolations);
    return reply.send(await uc.execute({
      identifier: query.identifier,
      identifier_type: query.identifier_type,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    }));
  });

  app.get('/rate-limit/unlocks', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string };
    const uc = container.resolve<ListRateLimitUnlocksUseCase>(UC_TOKENS.ListRateLimitUnlocks);
    return reply.send(await uc.execute({
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    }));
  });

  // ── IP Blocklist ─────────────────────────────────────────────────

  app.get('/ip-blocklist', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { is_active?: string; severity?: string; search?: string; limit?: string; offset?: string };
    const uc = container.resolve<ListIpBlocklistUseCase>(UC_TOKENS.ListIpBlocklist);
    return reply.send(await uc.execute({
      is_active: query.is_active !== undefined ? query.is_active === 'true' : undefined,
      severity: query.severity,
      search: query.search,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    }));
  });

  app.post<{ Body: { ip_address: string; reason: string; severity: string; expires_at?: string } }>(
    '/ip-blocklist',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { ip_address, reason, severity, expires_at } = request.body;
      if (!ip_address) return reply.code(400).send({ error: 'ip_address is required' });
      if (!reason) return reply.code(400).send({ error: 'reason is required' });
      const authUser = getAuthUser(request);
      const uc = container.resolve<AddIpBlockUseCase>(UC_TOKENS.AddIpBlock);
      return reply.code(201).send(await uc.execute({
        ip_address, reason, severity: severity || 'medium', admin_id: authUser.id, expires_at,
      }));
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/ip-blocklist/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid ID' });
      const authUser = getAuthUser(request);
      const uc = container.resolve<RemoveIpBlockUseCase>(UC_TOKENS.RemoveIpBlock);
      return reply.send(await uc.execute(id, authUser.id));
    },
  );

  // ── Customer Blocklist ───────────────────────────────────────────

  app.get('/customer-blocklist', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { is_active?: string; block_type?: string; search?: string; limit?: string; offset?: string };
    const uc = container.resolve<ListCustomerBlocklistUseCase>(UC_TOKENS.ListCustomerBlocklist);
    return reply.send(await uc.execute({
      is_active: query.is_active !== undefined ? query.is_active === 'true' : undefined,
      block_type: query.block_type,
      search: query.search,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    }));
  });

  app.post<{ Body: { user_id?: string; email?: string; ip_address?: string; card_fingerprint?: string; reason: string; severity?: string } }>(
    '/customer-blocklist',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { user_id, email, ip_address, card_fingerprint, reason, severity } = request.body;
      if (!reason) return reply.code(400).send({ error: 'reason is required' });
      const authUser = getAuthUser(request);
      const uc = container.resolve<BlockCustomerUseCase>(UC_TOKENS.BlockCustomer);
      return reply.code(201).send(await uc.execute({
        user_id, email, ip_address, card_fingerprint, admin_id: authUser.id, reason, severity,
      }));
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/customer-blocklist/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid ID' });
      const authUser = getAuthUser(request);
      const uc = container.resolve<RemoveCustomerBlockUseCase>(UC_TOKENS.RemoveCustomerBlock);
      return reply.send(await uc.execute(id, authUser.id));
    },
  );

  // ── Force Logout ─────────────────────────────────────────────────

  app.post<{ Body: { user_id: string } }>(
    '/force-logout',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { user_id } = request.body;
      if (!user_id || !UUID_RE.test(user_id)) return reply.code(400).send({ error: 'valid user_id is required' });
      const authUser = getAuthUser(request);
      const uc = container.resolve<ForceLogoutUseCase>(UC_TOKENS.ForceLogout);
      return reply.send(await uc.execute({ user_id, admin_id: authUser.id }));
    },
  );

  // ── Surge State & Platform Settings ──────────────────────────────

  app.get('/surge-state', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const uc = container.resolve<GetSurgeStateUseCase>(UC_TOKENS.GetSurgeState);
    return reply.send(await uc.execute());
  });

  app.get<{ Params: { key: string } }>(
    '/platform-settings/:key',
    { preHandler: [employeeGuard] },
    async (request, reply) => {
      const { key } = request.params;
      const uc = container.resolve<GetPlatformSecuritySettingUseCase>(UC_TOKENS.GetPlatformSecuritySetting);
      const result = await uc.execute(key);
      if (!result) return reply.code(404).send({ error: 'Setting not found' });
      return reply.send(result);
    },
  );

  app.put<{ Params: { key: string }; Body: { value: unknown } }>(
    '/platform-settings/:key',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { key } = request.params;
      const { value } = request.body;
      const authUser = getAuthUser(request);
      const uc = container.resolve<UpdatePlatformSecuritySettingUseCase>(UC_TOKENS.UpdatePlatformSecuritySetting);
      return reply.send(await uc.execute({ key, value, admin_id: authUser.id }));
    },
  );

  // ── Audit Log ────────────────────────────────────────────────────

  app.get('/audit-log', { preHandler: [employeeGuard] }, async (request, reply) => {
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
