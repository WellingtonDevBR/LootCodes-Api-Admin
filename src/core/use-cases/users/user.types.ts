export interface GetComprehensiveUserDataDto {
  user_id: string;
}

export interface GetComprehensiveUserDataResult {
  user: unknown;
}

export interface GetUserTimelineDto {
  user_id: string;
  limit?: number;
  offset?: number;
}

export interface GetUserTimelineResult {
  timeline: unknown[];
}

export interface GetUserSessionsDto {
  user_id: string;
}

export interface GetUserSessionsResult {
  sessions: unknown[];
}

export interface SearchAccountProfilesDto {
  query: string;
  limit?: number;
  offset?: number;
}

export interface SearchAccountProfilesResult {
  profiles: unknown[];
  total: number;
}

export interface ToggleUserRoleDto {
  user_id: string;
  role: string;
  admin_id: string;
}

export interface ToggleUserRoleResult {
  success: boolean;
  new_role: string;
}

export interface DeleteUserAccountDto {
  user_id: string;
  admin_id: string;
  reason: string;
}

export interface DeleteUserAccountResult {
  success: boolean;
}

export interface ListCustomersDto {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface CustomerRow {
  id: string;
  email: string;
  name: string | null;
  joined: string;
  orders_count: number;
  total_spent_cents: number;
  account_status: string;
  last_order_at: string | null;
}

export interface ListCustomersResult {
  customers: CustomerRow[];
  total: number;
}
