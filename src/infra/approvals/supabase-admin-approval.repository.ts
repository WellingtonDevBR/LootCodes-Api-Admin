import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminApprovalRepository } from '../../core/ports/admin-approval-repository.port.js';
import type {
  RequestActionDto,
  RequestActionResult,
  ApproveActionDto,
  ApproveActionResult,
  RejectActionDto,
  RejectActionResult,
  ListActionRequestsDto,
  ListActionRequestsResult,
} from '../../core/use-cases/approvals/approval.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminApprovalRepository');

const DEFAULT_PAGE_LIMIT = 25;

@injectable()
export class SupabaseAdminApprovalRepository implements IAdminApprovalRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async requestAction(dto: RequestActionDto): Promise<RequestActionResult> {
    logger.info('Requesting action approval', { action: dto.action, targetId: dto.target_id });

    const result = await this.db.rpc<{ request_id: string }>(
      'admin_request_action',
      {
        p_action: dto.action,
        p_target_id: dto.target_id,
        p_target_type: dto.target_type,
        p_summary: dto.summary,
        p_admin_id: dto.admin_id,
        p_payload: dto.payload ?? null,
      },
    );

    return { request_id: result.request_id };
  }

  async approveAction(dto: ApproveActionDto): Promise<ApproveActionResult> {
    logger.info('Approving action request', { requestId: dto.request_id, adminId: dto.admin_id });

    await this.db.rpc('admin_approve_action', {
      p_request_id: dto.request_id,
      p_admin_id: dto.admin_id,
    });

    return { success: true };
  }

  async rejectAction(dto: RejectActionDto): Promise<RejectActionResult> {
    logger.info('Rejecting action request', { requestId: dto.request_id, adminId: dto.admin_id });

    await this.db.rpc('admin_reject_action', {
      p_request_id: dto.request_id,
      p_admin_id: dto.admin_id,
      p_reason: dto.reason,
    });

    return { success: true };
  }

  async listActionRequests(dto: ListActionRequestsDto): Promise<ListActionRequestsResult> {
    const result = await this.db.rpc<{ requests: unknown[]; total: number }>(
      'admin_list_action_requests',
      {
        p_page: dto.page ?? 1,
        p_limit: dto.limit ?? DEFAULT_PAGE_LIMIT,
        p_status: dto.status ?? null,
      },
    );

    return {
      requests: result.requests ?? [],
      total: result.total ?? 0,
    };
  }
}
