import type {
  ListClaimsDto,
  ListClaimsResult,
  PriceMatchClaimRow,
  ClaimConfidenceResult,
  ApprovePriceMatchDto,
  ApprovePriceMatchResult,
  RejectPriceMatchDto,
  RejectPriceMatchResult,
  PreviewPriceMatchDiscountDto,
  PreviewPriceMatchDiscountResult,
  GetScreenshotUrlResult,
  TrustedRetailerRow,
  CreateRetailerDto,
  UpdateRetailerDto,
  BlockedDomainRow,
  CreateBlockedDomainDto,
  UpdateBlockedDomainDto,
  PriceMatchConfigResult,
  UpdatePriceMatchConfigDto,
  ExpirePriceMatchClaimsResult,
  ProcessPriceDropRefundsResult,
} from '../use-cases/price-match/price-match.types.js';

export interface IAdminPriceMatchRepository {
  // Claims
  listClaims(dto: ListClaimsDto): Promise<ListClaimsResult>;
  getClaimDetail(claimId: string): Promise<PriceMatchClaimRow | null>;
  getClaimConfidence(claimId: string): Promise<ClaimConfidenceResult | null>;
  getScreenshotUrl(screenshotPath: string): Promise<GetScreenshotUrlResult>;

  // Mutations
  approvePriceMatch(dto: ApprovePriceMatchDto): Promise<ApprovePriceMatchResult>;
  rejectPriceMatch(dto: RejectPriceMatchDto): Promise<RejectPriceMatchResult>;
  previewDiscount(dto: PreviewPriceMatchDiscountDto): Promise<PreviewPriceMatchDiscountResult>;

  // Trusted Retailers
  listRetailers(): Promise<TrustedRetailerRow[]>;
  createRetailer(dto: CreateRetailerDto): Promise<string | null>;
  updateRetailer(dto: UpdateRetailerDto): Promise<boolean>;

  // Blocked Domains
  listBlockedDomains(): Promise<BlockedDomainRow[]>;
  createBlockedDomain(dto: CreateBlockedDomainDto): Promise<string | null>;
  updateBlockedDomain(dto: UpdateBlockedDomainDto): Promise<boolean>;

  // Config
  getConfig(): Promise<PriceMatchConfigResult>;
  updateConfig(dto: UpdatePriceMatchConfigDto): Promise<boolean>;

  // Cron operations
  expireStaleClaims(): Promise<ExpirePriceMatchClaimsResult>;
  processPriceDropRefunds(): Promise<ProcessPriceDropRefundsResult>;
}
