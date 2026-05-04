import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminSecurityRepository } from '../../core/ports/admin-security-repository.port.js';
import type {
  GetSecurityConfigsResult,
  UpdateSecurityConfigDto,
  UpdateSecurityConfigResult,
  UnlockRateLimitDto,
  UnlockRateLimitResult,
  DirectUnlockRateLimitDto,
  DirectUnlockRateLimitResult,
  ListRateLimitViolationsFilters,
  ListRateLimitViolationsResult,
  RateLimitViolation,
  ListRateLimitUnlocksFilters,
  ListRateLimitUnlocksResult,
  RateLimitUnlockEntry,
  ListIpBlocklistFilters,
  ListIpBlocklistResult,
  IpBlocklistEntry,
  AddIpBlockDto,
  AddIpBlockResult,
  RemoveIpBlockResult,
  ListCustomerBlocklistFilters,
  ListCustomerBlocklistResult,
  CustomerBlocklistEntry,
  BlockCustomerDto,
  BlockCustomerResult,
  RemoveCustomerBlockResult,
  ForceLogoutDto,
  ForceLogoutResult,
  SurgeStateResult,
  SurgeMetric,
  PlatformSettingResult,
  UpdatePlatformSettingDto,
  UpdatePlatformSettingResult,
  ListAuditLogFilters,
  ListAuditLogResult,
  AuditLogEntry,
  SecurityConfigEntry,
} from '../../core/use-cases/security/security.types.js';

@injectable()
export class SupabaseAdminSecurityRepository implements IAdminSecurityRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  // ── Security Configs ─────────────────────────────────────────────

  async getSecurityConfigs(): Promise<GetSecurityConfigsResult> {
    const configs = await this.db.query<SecurityConfigEntry>(
      'security_config',
      { select: 'config_key, config_value, description, updated_at, updated_by', order: { column: 'config_key', ascending: true } },
    );
    return { configs };
  }

  async updateSecurityConfig(dto: UpdateSecurityConfigDto): Promise<UpdateSecurityConfigResult> {
    await this.db.update(
      'security_config',
      { config_key: dto.key },
      { config_value: dto.value, updated_at: new Date().toISOString(), updated_by: dto.admin_id },
    );
    return { success: true };
  }

  // ── Rate Limit Unlock ────────────────────────────────────────────

  async unlockRateLimit(dto: UnlockRateLimitDto): Promise<UnlockRateLimitResult> {
    await this.db.rpc('admin_unlock_rate_limit', {
      p_identifier: dto.identifier,
      p_admin_id: dto.admin_id,
      p_sms_code: dto.sms_code ?? null,
    });
    return { success: true };
  }

  async directUnlockRateLimit(dto: DirectUnlockRateLimitDto): Promise<DirectUnlockRateLimitResult> {
    await this.db.rpc('admin_direct_unlock_rate_limit', {
      p_identifier: dto.identifier,
      p_admin_id: dto.admin_id,
    });
    return { success: true };
  }

  // ── Rate Limit Violations ────────────────────────────────────────

  async listRateLimitViolations(filters: ListRateLimitViolationsFilters): Promise<ListRateLimitViolationsResult> {
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const eq: Array<[string, unknown]> = [];
    if (filters.identifier_type) eq.push(['identifier_type', filters.identifier_type]);

    const ilike: Array<[string, string]> = [];
    if (filters.identifier) ilike.push(['identifier', `%${filters.identifier}%`]);

    const { data, total } = await this.db.queryPaginated<RateLimitViolation>('rate_limits', {
      select: 'identifier, identifier_type, limit_type, action_type, attempt_count, is_blocked, blocked_until, ip_address, created_at',
      eq: eq.length > 0 ? eq : undefined,
      ilike: ilike.length > 0 ? ilike : undefined,
      order: { column: 'created_at', ascending: false },
      range: [offset, offset + limit - 1],
    });

    return { violations: data, total };
  }

  // ── Rate Limit Unlock History ────────────────────────────────────

  async listRateLimitUnlocks(filters: ListRateLimitUnlocksFilters): Promise<ListRateLimitUnlocksResult> {
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const { data, total } = await this.db.queryPaginated<RateLimitUnlockEntry>('rate_limit_unlocks', {
      select: 'id, identifier, identifier_type, unlocked_by, reason, ticket_id, records_cleared, created_at, metadata',
      order: { column: 'created_at', ascending: false },
      range: [offset, offset + limit - 1],
    });

    return { unlocks: data, total };
  }

  // ── IP Blocklist ─────────────────────────────────────────────────

  async listIpBlocklist(filters: ListIpBlocklistFilters): Promise<ListIpBlocklistResult> {
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const eq: Array<[string, unknown]> = [];
    if (filters.is_active !== undefined) eq.push(['is_active', filters.is_active]);
    if (filters.severity) eq.push(['severity', filters.severity]);

    const ilike: Array<[string, string]> = [];
    if (filters.search) ilike.push(['ip_address', `%${filters.search}%`]);

    const { data, total } = await this.db.queryPaginated<IpBlocklistEntry>('ip_blocklist', {
      select: 'id, ip_address, blocked_reason, severity, blocked_by, blocked_at, expires_at, is_active, auto_blocked, metadata, created_at',
      eq: eq.length > 0 ? eq : undefined,
      ilike: ilike.length > 0 ? ilike : undefined,
      order: { column: 'blocked_at', ascending: false },
      range: [offset, offset + limit - 1],
    });

    return { entries: data, total };
  }

  async addIpBlock(dto: AddIpBlockDto): Promise<AddIpBlockResult> {
    const row = await this.db.insert<{ id: string }>('ip_blocklist', {
      ip_address: dto.ip_address,
      blocked_reason: dto.reason,
      severity: dto.severity,
      blocked_by: dto.admin_id,
      blocked_at: new Date().toISOString(),
      expires_at: dto.expires_at ?? null,
      is_active: true,
      auto_blocked: false,
    });
    return { success: true, id: row.id };
  }

  async removeIpBlock(id: string): Promise<RemoveIpBlockResult> {
    await this.db.update('ip_blocklist', { id }, { is_active: false, updated_at: new Date().toISOString() });
    return { success: true };
  }

  // ── Customer Blocklist ───────────────────────────────────────────

  async listCustomerBlocklist(filters: ListCustomerBlocklistFilters): Promise<ListCustomerBlocklistResult> {
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const eq: Array<[string, unknown]> = [];
    if (filters.is_active !== undefined) eq.push(['is_active', filters.is_active]);
    if (filters.block_type) eq.push(['block_type', filters.block_type]);

    const ilike: Array<[string, string]> = [];
    if (filters.search) ilike.push(['email', `%${filters.search}%`]);

    const { data, total } = await this.db.queryPaginated<CustomerBlocklistEntry>('customer_blocklist', {
      select: 'id, user_id, email, ip_address, card_fingerprint, block_type, blocked_reason, severity, blocked_by, blocked_at, expires_at, is_active, auto_blocked, metadata, created_at',
      eq: eq.length > 0 ? eq : undefined,
      ilike: ilike.length > 0 ? ilike : undefined,
      order: { column: 'blocked_at', ascending: false },
      range: [offset, offset + limit - 1],
    });

    return { entries: data, total };
  }

  async blockCustomer(dto: BlockCustomerDto): Promise<BlockCustomerResult> {
    const result = await this.db.rpc<{ blocked_id: string }>('admin_block_customer', {
      p_user_id: dto.user_id ?? null,
      p_email: dto.email ?? null,
      p_ip_address: dto.ip_address ?? null,
      p_admin_id: dto.admin_id,
      p_reason: dto.reason,
    });
    return { success: true, blocked_id: result.blocked_id };
  }

  async removeCustomerBlock(id: string): Promise<RemoveCustomerBlockResult> {
    await this.db.update('customer_blocklist', { id }, { is_active: false, updated_at: new Date().toISOString() });
    return { success: true };
  }

  // ── Force Logout ─────────────────────────────────────────────────

  async forceLogout(dto: ForceLogoutDto): Promise<ForceLogoutResult> {
    const result = await this.db.rpc<{ sessions_invalidated: number }>(
      'invalidate_all_user_sessions',
      { p_user_id: dto.user_id },
    );
    return { success: true, sessions_invalidated: result.sessions_invalidated };
  }

  // ── Surge State ──────────────────────────────────────────────────

  async getSurgeState(): Promise<SurgeStateResult> {
    const metrics = await this.db.query<SurgeMetric>('surge_state', {
      select: 'metric, current_value, surge_level, window_minutes, threshold_elevated, threshold_critical, last_computed_at, metadata',
      order: { column: 'metric', ascending: true },
    });

    const fulfillmentMode = await this.db.queryOne<{ value: unknown }>('platform_settings', {
      eq: [['key', 'fulfillment_mode']],
      select: 'value',
    });

    const surgeConfig = await this.db.queryOne<{ value: unknown }>('platform_settings', {
      eq: [['key', 'global_surge_config']],
      select: 'value',
    });

    return {
      metrics,
      fulfillment_mode: fulfillmentMode?.value ?? 'auto',
      global_surge_config: surgeConfig?.value ?? {},
    };
  }

  // ── Platform Settings ────────────────────────────────────────────

  async getPlatformSetting(key: string): Promise<PlatformSettingResult | null> {
    const row = await this.db.queryOne<{ key: string; value: unknown; updated_at: string }>('platform_settings', {
      eq: [['key', key]],
      select: 'key, value, updated_at',
    });
    return row;
  }

  async updatePlatformSetting(dto: UpdatePlatformSettingDto): Promise<UpdatePlatformSettingResult> {
    await this.db.upsert('platform_settings', {
      key: dto.key,
      value: dto.value,
      updated_at: new Date().toISOString(),
    }, 'key');
    return { success: true };
  }

  // ── Audit Log ────────────────────────────────────────────────────

  async listAuditLog(filters: ListAuditLogFilters): Promise<ListAuditLogResult> {
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const eq: Array<[string, unknown]> = [];
    if (filters.action_type) eq.push(['action_type', filters.action_type]);
    if (filters.target_type) eq.push(['target_type', filters.target_type]);
    if (filters.admin_user_id) eq.push(['admin_user_id', filters.admin_user_id]);

    const { data, total } = await this.db.queryPaginated<AuditLogEntry>('admin_actions', {
      select: 'id, admin_user_id, action_type, target_id, target_type, details, ip_address, admin_email, admin_name, created_at',
      eq: eq.length > 0 ? eq : undefined,
      order: { column: 'created_at', ascending: false },
      range: [offset, offset + limit - 1],
    });

    return { entries: data, total };
  }

  // ── Admin Action Logging ─────────────────────────────────────────

  async logAdminAction(
    adminId: string,
    actionType: string,
    targetType: string,
    targetId: string,
    metadata?: unknown,
  ): Promise<void> {
    await this.db.rpc('log_admin_action', {
      p_admin_id: adminId,
      p_action_type: actionType,
      p_target_type: targetType,
      p_target_id: targetId,
      p_metadata: metadata ?? {},
      p_ip_address: null,
    });
  }
}
