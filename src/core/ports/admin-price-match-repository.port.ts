import type {
  ApprovePriceMatchDto,
  ApprovePriceMatchResult,
  RejectPriceMatchDto,
  RejectPriceMatchResult,
  PreviewPriceMatchDiscountDto,
  PreviewPriceMatchDiscountResult,
} from '../use-cases/price-match/price-match.types.js';

export interface IAdminPriceMatchRepository {
  approvePriceMatch(dto: ApprovePriceMatchDto): Promise<ApprovePriceMatchResult>;
  rejectPriceMatch(dto: RejectPriceMatchDto): Promise<RejectPriceMatchResult>;
  previewPriceMatchDiscount(dto: PreviewPriceMatchDiscountDto): Promise<PreviewPriceMatchDiscountResult>;
}
