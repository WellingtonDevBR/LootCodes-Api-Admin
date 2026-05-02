import type {
  ListTrustpilotReviewClaimsDto,
  ListTrustpilotReviewClaimsResult,
  ResolveTrustpilotReviewClaimDto,
  ResolveTrustpilotReviewClaimResult,
} from '../use-cases/reviews/review.types.js';

export interface IAdminReviewRepository {
  listTrustpilotReviewClaims(dto: ListTrustpilotReviewClaimsDto): Promise<ListTrustpilotReviewClaimsResult>;
  resolveTrustpilotReviewClaim(dto: ResolveTrustpilotReviewClaimDto): Promise<ResolveTrustpilotReviewClaimResult>;
}
