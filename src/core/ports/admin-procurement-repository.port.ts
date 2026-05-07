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
  RecoverProviderOrderDto,
  RecoverProviderOrderResult,
  SearchCatalogDto,
  SearchCatalogResult,
  LinkCatalogProductDto,
  LinkCatalogProductResult,
  LiveSearchProvidersDto,
  LiveSearchProvidersResult,
  GetProcurementConfigResult,
  UpdateProcurementConfigDto,
  ProcurementConfig,
  ListPurchaseQueueDto,
  ListPurchaseQueueResult,
  CancelQueueItemDto,
  CancelQueueItemResult,
  ListPurchaseAttemptsDto,
  ListPurchaseAttemptsResult,
} from '../use-cases/procurement/procurement.types.js';

export interface IAdminProcurementRepository {
  testProviderQuote(dto: TestProviderQuoteDto): Promise<TestProviderQuoteResult>;
  searchProviders(dto: SearchProvidersDto): Promise<SearchProvidersResult>;
  manageProviderOffer(dto: ManageProviderOfferDto): Promise<ManageProviderOfferResult>;
  ingestProviderCatalog(dto: IngestProviderCatalogDto): Promise<IngestProviderCatalogResult>;
  ingestProviderCatalogStatus(dto: IngestProviderCatalogStatusDto): Promise<IngestProviderCatalogStatusResult>;
  refreshProviderPrices(dto: RefreshProviderPricesDto): Promise<RefreshProviderPricesResult>;
  recoverProviderOrder(dto: RecoverProviderOrderDto): Promise<RecoverProviderOrderResult>;
  searchCatalog(dto: SearchCatalogDto): Promise<SearchCatalogResult>;
  linkCatalogProduct(dto: LinkCatalogProductDto): Promise<LinkCatalogProductResult>;
  liveSearchProviders(dto: LiveSearchProvidersDto): Promise<LiveSearchProvidersResult>;

  getProcurementConfig(): Promise<GetProcurementConfigResult>;
  updateProcurementConfig(dto: UpdateProcurementConfigDto): Promise<ProcurementConfig>;
  listPurchaseQueue(dto: ListPurchaseQueueDto): Promise<ListPurchaseQueueResult>;
  cancelQueueItem(dto: CancelQueueItemDto): Promise<CancelQueueItemResult>;
  listPurchaseAttempts(dto: ListPurchaseAttemptsDto): Promise<ListPurchaseAttemptsResult>;
}
