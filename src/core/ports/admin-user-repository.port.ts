import type {
  GetComprehensiveUserDataDto,
  GetComprehensiveUserDataResult,
  GetUserTimelineDto,
  GetUserTimelineResult,
  GetUserSessionsDto,
  GetUserSessionsResult,
  SearchAccountProfilesDto,
  SearchAccountProfilesResult,
  ToggleUserRoleDto,
  ToggleUserRoleResult,
  DeleteUserAccountDto,
  DeleteUserAccountResult,
} from '../use-cases/users/user.types.js';

export interface IAdminUserRepository {
  getComprehensiveUserData(dto: GetComprehensiveUserDataDto): Promise<GetComprehensiveUserDataResult>;
  getUserTimeline(dto: GetUserTimelineDto): Promise<GetUserTimelineResult>;
  getUserSessions(dto: GetUserSessionsDto): Promise<GetUserSessionsResult>;
  searchAccountProfiles(dto: SearchAccountProfilesDto): Promise<SearchAccountProfilesResult>;
  toggleUserRole(dto: ToggleUserRoleDto): Promise<ToggleUserRoleResult>;
  deleteUserAccount(dto: DeleteUserAccountDto): Promise<DeleteUserAccountResult>;
}
