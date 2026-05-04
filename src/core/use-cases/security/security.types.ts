// ── Security Configs ─────────────────────────────────────────────

export interface SecurityConfigEntry {
  config_key: string;
  config_value: unknown;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface GetSecurityConfigsResult {
  configs: SecurityConfigEntry[];
}

export interface UpdateSecurityConfigDto {
  key: string;
  value: unknown;
  admin_id: string;
}

export interface UpdateSecurityConfigResult {
  success: boolean;
}

// ── Rate Limit Unlock ────────────────────────────────────────────

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

// ── Rate Limit Violations ────────────────────────────────────────

export interface RateLimitViolation {
  identifier: string;
  identifier_type: string;
  limit_type: string;
  action_type: string | null;
  attempt_count: number;
  is_blocked: boolean;
  blocked_until: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface ListRateLimitViolationsFilters {
  identifier?: string;
  identifier_type?: string;
  limit?: number;
  offset?: number;
}

export interface ListRateLimitViolationsResult {
  violations: RateLimitViolation[];
  total: number;
}

// ── Rate Limit Unlock History ────────────────────────────────────

export interface RateLimitUnlockEntry {
  id: string;
  identifier: string;
  identifier_type: string;
  unlocked_by: string | null;
  reason: string | null;
  ticket_id: string | null;
  records_cleared: number | null;
  created_at: string;
  metadata: unknown;
}

export interface ListRateLimitUnlocksFilters {
  limit?: number;
  offset?: number;
}

export interface ListRateLimitUnlocksResult {
  unlocks: RateLimitUnlockEntry[];
  total: number;
}

// ── IP Blocklist ─────────────────────────────────────────────────

export interface IpBlocklistEntry {
  id: string;
  ip_address: string;
  blocked_reason: string;
  severity: string;
  blocked_by: string | null;
  blocked_at: string;
  expires_at: string | null;
  is_active: boolean;
  auto_blocked: boolean;
  metadata: unknown;
  created_at: string;
}

export interface ListIpBlocklistFilters {
  is_active?: boolean;
  severity?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListIpBlocklistResult {
  entries: IpBlocklistEntry[];
  total: number;
}

export interface AddIpBlockDto {
  ip_address: string;
  reason: string;
  severity: string;
  admin_id: string;
  expires_at?: string;
}

export interface AddIpBlockResult {
  success: boolean;
  id: string;
}

export interface RemoveIpBlockResult {
  success: boolean;
}

// ── Customer Blocklist ───────────────────────────────────────────

export interface CustomerBlocklistEntry {
  id: string;
  user_id: string | null;
  email: string | null;
  ip_address: string | null;
  card_fingerprint: string | null;
  block_type: string;
  blocked_reason: string;
  severity: string;
  blocked_by: string | null;
  blocked_at: string;
  expires_at: string | null;
  is_active: boolean;
  auto_blocked: boolean;
  metadata: unknown;
  created_at: string;
}

export interface ListCustomerBlocklistFilters {
  is_active?: boolean;
  block_type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListCustomerBlocklistResult {
  entries: CustomerBlocklistEntry[];
  total: number;
}

export interface BlockCustomerDto {
  user_id?: string;
  email?: string;
  ip_address?: string;
  card_fingerprint?: string;
  admin_id: string;
  reason: string;
  severity?: string;
}

export interface BlockCustomerResult {
  success: boolean;
  blocked_id: string;
}

export interface RemoveCustomerBlockResult {
  success: boolean;
}

// ── Force Logout ─────────────────────────────────────────────────

export interface ForceLogoutDto {
  user_id: string;
  admin_id: string;
}

export interface ForceLogoutResult {
  success: boolean;
  sessions_invalidated: number;
}

// ── Surge State & Platform Settings ──────────────────────────────

export interface SurgeMetric {
  metric: string;
  current_value: number;
  surge_level: string;
  window_minutes: number;
  threshold_elevated: number;
  threshold_critical: number;
  last_computed_at: string | null;
  metadata: unknown;
}

export interface SurgeStateResult {
  metrics: SurgeMetric[];
  fulfillment_mode: unknown;
  global_surge_config: unknown;
}

export interface PlatformSettingResult {
  key: string;
  value: unknown;
  updated_at: string;
}

export interface UpdatePlatformSettingDto {
  key: string;
  value: unknown;
  admin_id: string;
}

export interface UpdatePlatformSettingResult {
  success: boolean;
}

// ── Audit Log ────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  admin_user_id: string;
  action_type: string;
  target_id: string | null;
  target_type: string | null;
  details: unknown;
  ip_address: string | null;
  admin_email: string | null;
  admin_name: string | null;
  created_at: string;
}

export interface ListAuditLogFilters {
  action_type?: string;
  target_type?: string;
  admin_user_id?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export interface ListAuditLogResult {
  entries: AuditLogEntry[];
  total: number;
}
