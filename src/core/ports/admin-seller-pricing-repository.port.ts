import type {
  CalculatePayoutDto,
  CalculatePayoutResult,
  GetCompetitorsDto,
  GetCompetitorsResult,
  SuggestPriceDto,
  SuggestPriceResult,
  DryRunPricingDto,
  DryRunPricingResult,
  GetDecisionHistoryDto,
  GetDecisionHistoryResult,
  GetLatestDecisionDto,
  GetLatestDecisionResult,
  GetProviderDefaultsDto,
  GetProviderDefaultsResult,
} from '../use-cases/seller/seller-pricing.types.js';

export interface IAdminSellerPricingRepository {
  calculatePayout(dto: CalculatePayoutDto): Promise<CalculatePayoutResult>;
  getCompetitors(dto: GetCompetitorsDto): Promise<GetCompetitorsResult>;
  suggestPrice(dto: SuggestPriceDto): Promise<SuggestPriceResult>;
  dryRunPricing(dto: DryRunPricingDto): Promise<DryRunPricingResult>;
  getDecisionHistory(dto: GetDecisionHistoryDto): Promise<GetDecisionHistoryResult>;
  getLatestDecision(dto: GetLatestDecisionDto): Promise<GetLatestDecisionResult>;
  getProviderDefaults(dto: GetProviderDefaultsDto): Promise<GetProviderDefaultsResult>;
}
