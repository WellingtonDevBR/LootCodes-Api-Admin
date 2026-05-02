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
