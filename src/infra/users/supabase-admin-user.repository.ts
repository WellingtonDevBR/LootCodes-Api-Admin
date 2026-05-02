import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminUserRepository } from '../../core/ports/admin-user-repository.port.js';
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
} from '../../core/use-cases/users/user.types.js';

@injectable()
export class SupabaseAdminUserRepository implements IAdminUserRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async getComprehensiveUserData(dto: GetComprehensiveUserDataDto): Promise<GetComprehensiveUserDataResult> {
    const user = await this.db.rpc('get_comprehensive_user_data', {
      p_user_id: dto.user_id,
    });
    return { user };
  }

  async getUserTimeline(dto: GetUserTimelineDto): Promise<GetUserTimelineResult> {
    const timeline = await this.db.rpc<unknown[]>('get_user_timeline', {
      p_user_id: dto.user_id,
      p_limit: dto.limit ?? 50,
      p_offset: dto.offset ?? 0,
    });
    return { timeline: Array.isArray(timeline) ? timeline : [] };
  }

  async getUserSessions(dto: GetUserSessionsDto): Promise<GetUserSessionsResult> {
    const sessions = await this.db.rpc<unknown[]>('get_user_active_sessions', {
      p_user_id: dto.user_id,
    });
    return { sessions: Array.isArray(sessions) ? sessions : [] };
  }

  async searchAccountProfiles(dto: SearchAccountProfilesDto): Promise<SearchAccountProfilesResult> {
    const limit = dto.limit ?? 20;
    const offset = dto.offset ?? 0;

    const result = await this.db.rpc<{ profiles: unknown[]; total: number }>(
      'search_account_profiles',
      { p_query: dto.query, p_limit: limit, p_offset: offset },
    );

    return {
      profiles: Array.isArray(result.profiles) ? result.profiles : [],
      total: result.total ?? 0,
    };
  }

  async toggleUserRole(dto: ToggleUserRoleDto): Promise<ToggleUserRoleResult> {
    await this.db.update('profiles', { id: dto.user_id }, {
      role: dto.role,
      updated_at: new Date().toISOString(),
    });
    return { success: true, new_role: dto.role };
  }

  async deleteUserAccount(dto: DeleteUserAccountDto): Promise<DeleteUserAccountResult> {
    await this.db.rpc('admin_delete_user_account', {
      p_user_id: dto.user_id,
      p_admin_id: dto.admin_id,
      p_reason: dto.reason,
    });
    return { success: true };
  }
}
