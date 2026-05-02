import type {
  TestProviderQuoteDto,
  TestProviderQuoteResult,
  SearchProvidersDto,
  SearchProvidersResult,
  ManageProviderOfferDto,
  ManageProviderOfferResult,
  IngestProviderCatalogDto,
  IngestProviderCatalogResult,
  IngestProviderCatalogStatusDto,
  IngestProviderCatalogStatusResult,
  RefreshProviderPricesDto,
  RefreshProviderPricesResult,
  ManualProviderPurchaseDto,
  ManualProviderPurchaseResult,
  RecoverProviderOrderDto,
  RecoverProviderOrderResult,
} from '../use-cases/procurement/procurement.types.js';

export interface IAdminProcurementRepository {
  testProviderQuote(dto: TestProviderQuoteDto): Promise<TestProviderQuoteResult>;
  searchProviders(dto: SearchProvidersDto): Promise<SearchProvidersResult>;
  manageProviderOffer(dto: ManageProviderOfferDto): Promise<ManageProviderOfferResult>;
  ingestProviderCatalog(dto: IngestProviderCatalogDto): Promise<IngestProviderCatalogResult>;
  ingestProviderCatalogStatus(dto: IngestProviderCatalogStatusDto): Promise<IngestProviderCatalogStatusResult>;
  refreshProviderPrices(dto: RefreshProviderPricesDto): Promise<RefreshProviderPricesResult>;
  manualProviderPurchase(dto: ManualProviderPurchaseDto): Promise<ManualProviderPurchaseResult>;
  recoverProviderOrder(dto: RecoverProviderOrderDto): Promise<RecoverProviderOrderResult>;
}
