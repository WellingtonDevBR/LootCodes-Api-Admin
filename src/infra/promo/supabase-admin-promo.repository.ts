import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminPromoRepository } from '../../core/ports/admin-promo-repository.port.js';
import type {
  CreatePromoCodeDto,
  CreatePromoCodeResult,
  UpdatePromoCodeDto,
  UpdatePromoCodeResult,
  TogglePromoActiveDto,
  TogglePromoActiveResult,
  DeletePromoCodeDto,
  DeletePromoCodeResult,
  SubmitPromoApprovalDto,
  SubmitPromoApprovalResult,
  ApprovePromoCodeDto,
  ApprovePromoCodeResult,
  RejectPromoCodeDto,
  RejectPromoCodeResult,
  SendPromoNotificationsDto,
  SendPromoNotificationsResult,
  EstimatePromoReachDto,
  EstimatePromoReachResult,
  ListPromoCodesDto,
  ListPromoCodesResult,
  GetPromoUsageStatsDto,
  GetPromoUsageStatsResult,
} from '../../core/use-cases/promo/promo.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminPromoRepository');

const DEFAULT_PAGE_LIMIT = 25;

@injectable()
export class SupabaseAdminPromoRepository implements IAdminPromoRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async createPromoCode(dto: CreatePromoCodeDto): Promise<CreatePromoCodeResult> {
    logger.info('Creating promo code', { code: dto.code, adminId: dto.admin_id });

    const promoData: Record<string, unknown> = {
      code: dto.code.toUpperCase(),
      discount_type: dto.discount_type,
      discount_value: dto.discount_value,
      max_uses: dto.max_uses ?? null,
      min_order_cents: dto.min_order_cents ?? null,
      starts_at: dto.starts_at ?? null,
      expires_at: dto.expires_at ?? null,
      target_audience: dto.target_audience ?? null,
      created_by: dto.admin_id,
      approval_status: 'draft',
    };

    const result = await this.db.insert<{ id: string; code: string }>('promo_codes', promoData);

    if (dto.product_ids?.length) {
      for (const productId of dto.product_ids) {
        await this.db.insert('promo_code_products', {
          promo_code_id: result.id,
          product_id: productId,
        });
      }
    }

    return { id: result.id, code: result.code };
  }

  async updatePromoCode(dto: UpdatePromoCodeDto): Promise<UpdatePromoCodeResult> {
    logger.info('Updating promo code', { promoId: dto.promo_id, adminId: dto.admin_id });

    const { product_ids, admin_id: _adminId, ...updates } = dto.updates;

    if (Object.keys(updates).length > 0) {
      await this.db.update('promo_codes', { id: dto.promo_id }, updates as Record<string, unknown>);
    }

    if (product_ids !== undefined) {
      await this.db.delete('promo_code_products', { promo_code_id: dto.promo_id });
      for (const productId of product_ids) {
        await this.db.insert('promo_code_products', {
          promo_code_id: dto.promo_id,
          product_id: productId,
        });
      }
    }

    return { success: true };
  }

  async togglePromoActive(dto: TogglePromoActiveDto): Promise<TogglePromoActiveResult> {
    logger.info('Toggling promo active', { promoId: dto.promo_id, active: dto.active });

    await this.db.update('promo_codes', { id: dto.promo_id }, { is_active: dto.active });

    return { success: true };
  }

  async deletePromoCode(dto: DeletePromoCodeDto): Promise<DeletePromoCodeResult> {
    logger.info('Soft-deleting promo code', { promoId: dto.promo_id, adminId: dto.admin_id });

    await this.db.update('promo_codes', { id: dto.promo_id }, { approval_status: 'deleted' });

    return { success: true };
  }

  async submitPromoApproval(dto: SubmitPromoApprovalDto): Promise<SubmitPromoApprovalResult> {
    logger.info('Submitting promo for approval', { promoId: dto.promo_id, adminId: dto.admin_id });

    await this.db.update('promo_codes', { id: dto.promo_id }, { approval_status: 'pending_approval' });

    return { success: true };
  }

  async approvePromoCode(dto: ApprovePromoCodeDto): Promise<ApprovePromoCodeResult> {
    logger.info('Approving promo code', { promoId: dto.promo_id, adminId: dto.admin_id });

    await this.db.update('promo_codes', { id: dto.promo_id }, {
      approval_status: 'approved',
      approved_by: dto.admin_id,
      approved_at: new Date().toISOString(),
    });

    return { success: true };
  }

  async rejectPromoCode(dto: RejectPromoCodeDto): Promise<RejectPromoCodeResult> {
    logger.info('Rejecting promo code', { promoId: dto.promo_id, adminId: dto.admin_id });

    await this.db.update('promo_codes', { id: dto.promo_id }, {
      approval_status: 'rejected',
      rejection_reason: dto.reason,
      rejected_by: dto.admin_id,
      rejected_at: new Date().toISOString(),
    });

    return { success: true };
  }

  async sendPromoNotifications(dto: SendPromoNotificationsDto): Promise<SendPromoNotificationsResult> {
    logger.info('Sending promo notifications', { promoId: dto.promo_id, adminId: dto.admin_id });

    const promo = await this.db.queryOne<{ target_audience: Record<string, unknown> }>(
      'promo_codes',
      { filter: { id: dto.promo_id }, single: true },
    );

    const targetUsers = await this.db.rpc<{ user_ids: string[] }>(
      'get_promo_target_users',
      { p_promo_id: dto.promo_id, p_target_audience: promo?.target_audience ?? {} },
    );

    const userIds = targetUsers.user_ids ?? [];

    return { success: true, notifications_queued: userIds.length };
  }

  async estimatePromoReach(dto: EstimatePromoReachDto): Promise<EstimatePromoReachResult> {
    logger.info('Estimating promo reach');

    const result = await this.db.rpc<{ estimated_reach: number }>(
      'get_promo_target_users',
      { p_promo_id: null, p_target_audience: dto.target_audience },
    );

    return { estimated_reach: result.estimated_reach ?? 0 };
  }

  async listPromoCodes(dto: ListPromoCodesDto): Promise<ListPromoCodesResult> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? DEFAULT_PAGE_LIMIT;

    const result = await this.db.rpc<{ promo_codes: unknown[]; total: number }>(
      'admin_list_promo_codes',
      {
        p_page: page,
        p_limit: limit,
        p_search: dto.search ?? null,
        p_status: dto.status ?? null,
      },
    );

    return {
      promo_codes: result.promo_codes ?? [],
      total: result.total ?? 0,
    };
  }

  async getPromoUsageStats(dto: GetPromoUsageStatsDto): Promise<GetPromoUsageStatsResult> {
    logger.info('Getting promo usage stats', { promoId: dto.promo_id });

    const stats = await this.db.rpc('get_promo_usage_stats', { p_promo_id: dto.promo_id });

    return { stats };
  }
}
