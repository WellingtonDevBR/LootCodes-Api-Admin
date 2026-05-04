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
  ListCustomersDto,
  ListCustomersResult,
  CustomerRow,
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

  async listCustomers(dto: ListCustomersDto): Promise<ListCustomersResult> {
    const limit = dto.limit ?? 25;
    const offset = dto.offset ?? 0;

    const profiles = await this.db.query<Record<string, unknown>>('profiles', {
      select: 'id, user_id, full_name, username, created_at, account_status',
      order: { column: 'created_at', ascending: false },
      limit: limit + offset,
    });

    const sliced = profiles.slice(offset, offset + limit);
    const userIds = sliced.map(p => p.user_id as string).filter(Boolean);

    let orderStats: Record<string, { count: number; spent: number; last: string | null }> = {};
    let sessionLastSeen: Record<string, string> = {};

    if (userIds.length > 0) {
      const orders = await this.db.query<Record<string, unknown>>('orders', {
        select: 'user_id, total_amount, created_at',
        in: [['user_id', userIds]],
      });
      for (const o of orders) {
        const uid = o.user_id as string;
        const stats = orderStats[uid] ?? { count: 0, spent: 0, last: null };
        stats.count += 1;
        stats.spent += (o.total_amount as number) ?? 0;
        const createdAt = o.created_at as string;
        if (!stats.last || createdAt > stats.last) stats.last = createdAt;
        orderStats[uid] = stats;
      }

      const sessions = await this.db.query<Record<string, unknown>>('user_sessions', {
        select: 'user_id, last_activity',
        in: [['user_id', userIds]],
        order: { column: 'last_activity', ascending: false },
      });
      for (const s of sessions) {
        const uid = s.user_id as string;
        const activity = s.last_activity as string;
        if (!sessionLastSeen[uid] || activity > sessionLastSeen[uid]) {
          sessionLastSeen[uid] = activity;
        }
      }
    }

    const customers: CustomerRow[] = sliced.map(p => {
      const uid = (p.user_id as string) ?? (p.id as string);
      const stats = orderStats[uid] ?? { count: 0, spent: 0, last: null };
      return {
        id: uid,
        email: (p.username as string) ?? '',
        name: (p.full_name as string) ?? null,
        joined: (p.created_at as string) ?? '',
        orders_count: stats.count,
        total_spent_cents: stats.spent,
        account_status: (p.account_status as string) ?? 'active',
        last_order_at: stats.last,
        last_seen: sessionLastSeen[uid] ?? null,
      };
    });

    return {
      customers,
      total: profiles.length,
    };
  }
}
