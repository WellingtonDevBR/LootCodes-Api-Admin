import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminPriceMatchRepository } from '../../core/ports/admin-price-match-repository.port.js';
import type {
  ApprovePriceMatchDto,
  ApprovePriceMatchResult,
  RejectPriceMatchDto,
  RejectPriceMatchResult,
  PreviewPriceMatchDiscountDto,
  PreviewPriceMatchDiscountResult,
} from '../../core/use-cases/price-match/price-match.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminPriceMatchRepository');

@injectable()
export class SupabaseAdminPriceMatchRepository implements IAdminPriceMatchRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async approvePriceMatch(dto: ApprovePriceMatchDto): Promise<ApprovePriceMatchResult> {
    logger.info('Approving price match claim', { claimId: dto.claim_id, adminId: dto.admin_id });

    const result = await this.db.rpc<{ success: boolean; promo_code?: string }>(
      'admin_approve_price_match',
      {
        p_claim_id: dto.claim_id,
        p_admin_id: dto.admin_id,
        p_discount_cents: dto.discount_cents ?? null,
      },
    );

    return {
      success: result.success,
      promo_code: result.promo_code,
    };
  }

  async rejectPriceMatch(dto: RejectPriceMatchDto): Promise<RejectPriceMatchResult> {
    logger.info('Rejecting price match claim', { claimId: dto.claim_id, adminId: dto.admin_id });

    await this.db.rpc('admin_reject_price_match', {
      p_claim_id: dto.claim_id,
      p_admin_id: dto.admin_id,
      p_reason: dto.reason,
    });

    return { success: true };
  }

  async previewPriceMatchDiscount(dto: PreviewPriceMatchDiscountDto): Promise<PreviewPriceMatchDiscountResult> {
    const result = await this.db.rpc<{ suggested_discount_cents: number; confidence: number }>(
      'admin_preview_price_match_discount',
      { p_claim_id: dto.claim_id },
    );

    return {
      suggested_discount_cents: result.suggested_discount_cents,
      confidence: result.confidence,
    };
  }
}
