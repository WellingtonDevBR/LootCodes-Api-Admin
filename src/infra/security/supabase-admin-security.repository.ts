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
  BlockCustomerDto,
  BlockCustomerResult,
  ForceLogoutDto,
  ForceLogoutResult,
} from '../../core/use-cases/security/security.types.js';

@injectable()
export class SupabaseAdminSecurityRepository implements IAdminSecurityRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async getSecurityConfigs(): Promise<GetSecurityConfigsResult> {
    const configs = await this.db.query<{ key: string; value: unknown; updated_at: string }>(
      'security_config',
      { select: 'key, value, updated_at', order: { column: 'key', ascending: true } },
    );
    return { configs };
  }

  async updateSecurityConfig(dto: UpdateSecurityConfigDto): Promise<UpdateSecurityConfigResult> {
    await this.db.upsert('security_config', {
      key: dto.key,
      value: dto.value,
      updated_at: new Date().toISOString(),
      updated_by: dto.admin_id,
    }, 'key');
    return { success: true };
  }

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

  async forceLogout(dto: ForceLogoutDto): Promise<ForceLogoutResult> {
    const result = await this.db.rpc<{ sessions_invalidated: number }>(
      'invalidate_all_user_sessions',
      { p_user_id: dto.user_id },
    );
    return { success: true, sessions_invalidated: result.sessions_invalidated };
  }
}
