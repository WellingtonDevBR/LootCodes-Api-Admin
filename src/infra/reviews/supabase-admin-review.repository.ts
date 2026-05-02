import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminReviewRepository } from '../../core/ports/admin-review-repository.port.js';
import type {
  ListTrustpilotReviewClaimsDto,
  ListTrustpilotReviewClaimsResult,
  ResolveTrustpilotReviewClaimDto,
  ResolveTrustpilotReviewClaimResult,
} from '../../core/use-cases/reviews/review.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminReviewRepository');

const DEFAULT_PAGE_LIMIT = 25;

@injectable()
export class SupabaseAdminReviewRepository implements IAdminReviewRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async listTrustpilotReviewClaims(dto: ListTrustpilotReviewClaimsDto): Promise<ListTrustpilotReviewClaimsResult> {
    const result = await this.db.rpc<{ claims: unknown[]; total: number }>(
      'admin_list_trustpilot_review_claims',
      {
        p_page: dto.page ?? 1,
        p_limit: dto.limit ?? DEFAULT_PAGE_LIMIT,
        p_status: dto.status ?? null,
      },
    );

    return {
      claims: result.claims ?? [],
      total: result.total ?? 0,
    };
  }

  async resolveTrustpilotReviewClaim(dto: ResolveTrustpilotReviewClaimDto): Promise<ResolveTrustpilotReviewClaimResult> {
    logger.info('Resolving Trustpilot review claim', { claimId: dto.claim_id, resolution: dto.resolution });

    await this.db.rpc('admin_resolve_trustpilot_review_claim', {
      p_claim_id: dto.claim_id,
      p_resolution: dto.resolution,
      p_admin_id: dto.admin_id,
      p_reason: dto.reason ?? null,
    });

    return { success: true };
  }
}
