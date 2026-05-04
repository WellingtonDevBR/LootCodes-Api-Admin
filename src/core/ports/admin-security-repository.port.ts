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
  ListRateLimitUnlocksFilters,
  ListRateLimitUnlocksResult,
  ListIpBlocklistFilters,
  ListIpBlocklistResult,
  AddIpBlockDto,
  AddIpBlockResult,
  RemoveIpBlockResult,
  ListCustomerBlocklistFilters,
  ListCustomerBlocklistResult,
  BlockCustomerDto,
  BlockCustomerResult,
  RemoveCustomerBlockResult,
  ForceLogoutDto,
  ForceLogoutResult,
  SurgeStateResult,
  PlatformSettingResult,
  UpdatePlatformSettingDto,
  UpdatePlatformSettingResult,
  ListAuditLogFilters,
  ListAuditLogResult,
} from '../use-cases/security/security.types.js';

export interface IAdminSecurityRepository {
  // Security configs
  getSecurityConfigs(): Promise<GetSecurityConfigsResult>;
  updateSecurityConfig(dto: UpdateSecurityConfigDto): Promise<UpdateSecurityConfigResult>;

  // Rate limits
  unlockRateLimit(dto: UnlockRateLimitDto): Promise<UnlockRateLimitResult>;
  directUnlockRateLimit(dto: DirectUnlockRateLimitDto): Promise<DirectUnlockRateLimitResult>;
  listRateLimitViolations(filters: ListRateLimitViolationsFilters): Promise<ListRateLimitViolationsResult>;
  listRateLimitUnlocks(filters: ListRateLimitUnlocksFilters): Promise<ListRateLimitUnlocksResult>;

  // IP blocklist
  listIpBlocklist(filters: ListIpBlocklistFilters): Promise<ListIpBlocklistResult>;
  addIpBlock(dto: AddIpBlockDto): Promise<AddIpBlockResult>;
  removeIpBlock(id: string): Promise<RemoveIpBlockResult>;

  // Customer blocklist
  listCustomerBlocklist(filters: ListCustomerBlocklistFilters): Promise<ListCustomerBlocklistResult>;
  blockCustomer(dto: BlockCustomerDto): Promise<BlockCustomerResult>;
  removeCustomerBlock(id: string): Promise<RemoveCustomerBlockResult>;

  // Force logout
  forceLogout(dto: ForceLogoutDto): Promise<ForceLogoutResult>;

  // Surge & platform settings
  getSurgeState(): Promise<SurgeStateResult>;
  getPlatformSetting(key: string): Promise<PlatformSettingResult | null>;
  updatePlatformSetting(dto: UpdatePlatformSettingDto): Promise<UpdatePlatformSettingResult>;

  // Audit log
  listAuditLog(filters: ListAuditLogFilters): Promise<ListAuditLogResult>;

  // Admin action logging
  logAdminAction(adminId: string, actionType: string, targetType: string, targetId: string, metadata?: unknown): Promise<void>;
}
