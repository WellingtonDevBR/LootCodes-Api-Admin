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
} from '../use-cases/security/security.types.js';

export interface IAdminSecurityRepository {
  getSecurityConfigs(): Promise<GetSecurityConfigsResult>;
  updateSecurityConfig(dto: UpdateSecurityConfigDto): Promise<UpdateSecurityConfigResult>;
  unlockRateLimit(dto: UnlockRateLimitDto): Promise<UnlockRateLimitResult>;
  directUnlockRateLimit(dto: DirectUnlockRateLimitDto): Promise<DirectUnlockRateLimitResult>;
  blockCustomer(dto: BlockCustomerDto): Promise<BlockCustomerResult>;
  forceLogout(dto: ForceLogoutDto): Promise<ForceLogoutResult>;
}
