export interface GetSecurityConfigsResult {
  configs: Array<{ key: string; value: unknown; updated_at: string }>;
}

export interface UpdateSecurityConfigDto {
  key: string;
  value: unknown;
  admin_id: string;
}

export interface UpdateSecurityConfigResult {
  success: boolean;
}

export interface UnlockRateLimitDto {
  identifier: string;
  admin_id: string;
  sms_code?: string;
}

export interface UnlockRateLimitResult {
  success: boolean;
}

export interface DirectUnlockRateLimitDto {
  identifier: string;
  admin_id: string;
}

export interface DirectUnlockRateLimitResult {
  success: boolean;
}

export interface BlockCustomerDto {
  user_id?: string;
  email?: string;
  ip_address?: string;
  admin_id: string;
  reason: string;
}

export interface BlockCustomerResult {
  success: boolean;
  blocked_id: string;
}

export interface ForceLogoutDto {
  user_id: string;
  admin_id: string;
}

export interface ForceLogoutResult {
  success: boolean;
  sessions_invalidated: number;
}
