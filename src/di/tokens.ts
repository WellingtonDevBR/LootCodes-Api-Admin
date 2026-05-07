export const TOKENS = {
  // Infrastructure (low-level)
  Database: Symbol.for('IDatabase'),
  Storage: Symbol.for('IStorage'),

  // Auth
  AuthProvider: Symbol.for('IAuthProvider'),
  AdminRoleChecker: Symbol.for('IAdminRoleChecker'),
  IpBlocklist: Symbol.for('IIpBlocklist'),

  // Domain repositories
  AdminOrderRepository: Symbol.for('IAdminOrderRepository'),
  AdminInventoryRepository: Symbol.for('IAdminInventoryRepository'),
  AdminInventorySourceRepository: Symbol.for('IAdminInventorySourceRepository'),
  AdminUserRepository: Symbol.for('IAdminUserRepository'),
  AdminSecurityRepository: Symbol.for('IAdminSecurityRepository'),
  AdminPromoRepository: Symbol.for('IAdminPromoRepository'),
  AdminSupportRepository: Symbol.for('IAdminSupportRepository'),
  AdminCurrencyRepository: Symbol.for('IAdminCurrencyRepository'),
  AdminProcurementRepository: Symbol.for('IAdminProcurementRepository'),
  BuyerManualPurchaseService: Symbol.for('BuyerManualPurchaseService'),
  SellerJitProcurementService: Symbol.for('SellerJitProcurementService'),
  AdminPriceMatchRepository: Symbol.for('IAdminPriceMatchRepository'),
  AdminReferralRepository: Symbol.for('IAdminReferralRepository'),
  AdminReviewRepository: Symbol.for('IAdminReviewRepository'),
  AdminAnalyticsRepository: Symbol.for('IAdminAnalyticsRepository'),
  AdminNotificationRepository: Symbol.for('IAdminNotificationRepository'),
  AdminAlgoliaRepository: Symbol.for('IAdminAlgoliaRepository'),
  AdminSettingsRepository: Symbol.for('IAdminSettingsRepository'),
  AdminApprovalRepository: Symbol.for('IAdminApprovalRepository'),
  AdminAuditRepository: Symbol.for('IAdminAuditRepository'),
  AdminVerificationRepository: Symbol.for('IAdminVerificationRepository'),
  AdminAuthSmsRepository: Symbol.for('IAdminAuthSmsRepository'),
  AdminDigisellerRepository: Symbol.for('IAdminDigisellerRepository'),
  AdminPricingRepository: Symbol.for('IAdminPricingRepository'),
  AdminProductRepository: Symbol.for('IAdminProductRepository'),
  AdminSellerRepository: Symbol.for('IAdminSellerRepository'),
  AdminSellerPricingRepository: Symbol.for('IAdminSellerPricingRepository'),
  AdminOpportunitiesRepository: Symbol.for('IAdminOpportunitiesRepository'),
  AdminAlertsRepository: Symbol.for('IAdminAlertsRepository'),

  // Crypto & key management
  KeyDecryption: Symbol.for('IKeyDecryptionPort'),

  // Marketplace adapters & seller services
  MarketplaceAdapterRegistry: Symbol.for('IMarketplaceAdapterRegistry'),
  SellerKeyOperations: Symbol.for('ISellerKeyOperationsPort'),
  SellerDomainEvents: Symbol.for('ISellerDomainEventPort'),
  ListingHealth: Symbol.for('IListingHealthPort'),
  VariantUnavailability: Symbol.for('IVariantUnavailabilityPort'),

  // Kinguin outbound key upload
  KinguinKeyUpload: Symbol.for('IKinguinKeyUploadPort'),

  // Seller pricing services
  SellerPricingService: Symbol.for('ISellerPricingService'),
  SellerAutoPricingService: Symbol.for('ISellerAutoPricingService'),
  SellerPriceIntelligenceService: Symbol.for('SellerPriceIntelligenceService'),
  SellerCostBasisService: Symbol.for('SellerCostBasisService'),
  SellerStockSyncService: Symbol.for('ISellerStockSyncService'),
  ProcurementDeclaredStockReconcileService: Symbol.for('IProcurementDeclaredStockReconcileService'),

  // Shared infra
  EventBus: Symbol.for('IEventBus'),
  EmailSender: Symbol.for('IEmailSender'),
  NotificationDispatcher: Symbol.for('INotificationDispatcher'),
} as const;

export const UC_TOKENS = {
  // Orders & Fulfillment
  FulfillVerifiedOrder: Symbol.for('FulfillVerifiedOrderUseCase'),
  ManualFulfill: Symbol.for('ManualFulfillUseCase'),
  RecoverOrder: Symbol.for('RecoverOrderUseCase'),
  ConfirmPayment: Symbol.for('ConfirmPaymentUseCase'),
  ProcessPreorder: Symbol.for('ProcessPreorderUseCase'),
  GenerateGuestAccessLink: Symbol.for('GenerateGuestAccessLinkUseCase'),
  RefundOrder: Symbol.for('RefundOrderUseCase'),
  RefundTicket: Symbol.for('RefundTicketUseCase'),
  RefundInitiate: Symbol.for('RefundInitiateUseCase'),
  ListOrders: Symbol.for('ListOrdersUseCase'),
  GetOrderDetail: Symbol.for('GetOrderDetailUseCase'),
  ReissueEmail: Symbol.for('ReissueEmailUseCase'),

  // Inventory & Keys
  EmitInventoryStockChanged: Symbol.for('EmitInventoryStockChangedUseCase'),
  SendStockNotificationsNow: Symbol.for('SendStockNotificationsNowUseCase'),
  ReplaceKey: Symbol.for('ReplaceKeyUseCase'),
  FixKeyStates: Symbol.for('FixKeyStatesUseCase'),
  UpdateAffectedKey: Symbol.for('UpdateAffectedKeyUseCase'),
  DecryptKeys: Symbol.for('DecryptKeysUseCase'),
  RecryptProductKeys: Symbol.for('RecryptProductKeysUseCase'),
  SetKeysSalesBlocked: Symbol.for('SetKeysSalesBlockedUseCase'),
  SetVariantSalesBlocked: Symbol.for('SetVariantSalesBlockedUseCase'),
  MarkKeysFaulty: Symbol.for('MarkKeysFaultyUseCase'),
  LinkReplacementKey: Symbol.for('LinkReplacementKeyUseCase'),
  ManualSell: Symbol.for('ManualSellUseCase'),
  UpdateVariantPrice: Symbol.for('UpdateVariantPriceUseCase'),
  GetInventoryCatalog: Symbol.for('GetInventoryCatalogUseCase'),
  GetVariantContext: Symbol.for('GetVariantContextUseCase'),

  // Inventory Sources
  LinkVariantInventorySource: Symbol.for('LinkVariantInventorySourceUseCase'),
  UnlinkVariantInventorySource: Symbol.for('UnlinkVariantInventorySourceUseCase'),
  ListVariantInventorySources: Symbol.for('ListVariantInventorySourcesUseCase'),
  ListLinkableInventorySources: Symbol.for('ListLinkableInventorySourcesUseCase'),

  // Users
  GetComprehensiveUserData: Symbol.for('GetComprehensiveUserDataUseCase'),
  GetUserTimeline: Symbol.for('GetUserTimelineUseCase'),
  GetUserSessions: Symbol.for('GetUserSessionsUseCase'),
  SearchAccountProfiles: Symbol.for('SearchAccountProfilesUseCase'),
  ToggleUserRole: Symbol.for('ToggleUserRoleUseCase'),
  DeleteUserAccount: Symbol.for('DeleteUserAccountUseCase'),
  BlockCustomer: Symbol.for('BlockCustomerUseCase'),
  ForceLogout: Symbol.for('ForceLogoutUseCase'),
  ListCustomers: Symbol.for('ListCustomersUseCase'),

  // Security & Fraud
  GetSecurityConfigs: Symbol.for('GetSecurityConfigsUseCase'),
  UpdateSecurityConfig: Symbol.for('UpdateSecurityConfigUseCase'),
  UnlockRateLimit: Symbol.for('UnlockRateLimitUseCase'),
  DirectUnlockRateLimit: Symbol.for('DirectUnlockRateLimitUseCase'),
  ListRateLimitViolations: Symbol.for('ListRateLimitViolationsUseCase'),
  ListRateLimitUnlocks: Symbol.for('ListRateLimitUnlocksUseCase'),
  ListIpBlocklist: Symbol.for('ListIpBlocklistUseCase'),
  AddIpBlock: Symbol.for('AddIpBlockUseCase'),
  RemoveIpBlock: Symbol.for('RemoveIpBlockUseCase'),
  ListCustomerBlocklist: Symbol.for('ListCustomerBlocklistUseCase'),
  RemoveCustomerBlock: Symbol.for('RemoveCustomerBlockUseCase'),
  GetSurgeState: Symbol.for('GetSurgeStateUseCase'),
  GetPlatformSecuritySetting: Symbol.for('GetPlatformSecuritySettingUseCase'),
  UpdatePlatformSecuritySetting: Symbol.for('UpdatePlatformSecuritySettingUseCase'),
  ListSecurityAuditLog: Symbol.for('ListSecurityAuditLogUseCase'),

  // Promo Codes
  CreatePromoCode: Symbol.for('CreatePromoCodeUseCase'),
  UpdatePromoCode: Symbol.for('UpdatePromoCodeUseCase'),
  TogglePromoActive: Symbol.for('TogglePromoActiveUseCase'),
  DeletePromoCode: Symbol.for('DeletePromoCodeUseCase'),
  SubmitPromoApproval: Symbol.for('SubmitPromoApprovalUseCase'),
  ApprovePromoCode: Symbol.for('ApprovePromoCodeUseCase'),
  RejectPromoCode: Symbol.for('RejectPromoCodeUseCase'),
  SendPromoNotifications: Symbol.for('SendPromoNotificationsUseCase'),
  EstimatePromoReach: Symbol.for('EstimatePromoReachUseCase'),
  ListPromoCodes: Symbol.for('ListPromoCodesUseCase'),
  GetPromoUsageStats: Symbol.for('GetPromoUsageStatsUseCase'),

  // Support
  ListTickets: Symbol.for('ListTicketsUseCase'),
  GetTicket: Symbol.for('GetTicketUseCase'),
  UpdateTicketStatus: Symbol.for('UpdateTicketStatusUseCase'),
  UpdateTicketPriority: Symbol.for('UpdateTicketPriorityUseCase'),
  AddTicketMessage: Symbol.for('AddTicketMessageUseCase'),
  ProcessTicketRefund: Symbol.for('ProcessTicketRefundUseCase'),

  // Currency
  GetCurrencyRates: Symbol.for('GetCurrencyRatesUseCase'),
  AddCurrencyRate: Symbol.for('AddCurrencyRateUseCase'),
  UpdateCurrencyRate: Symbol.for('UpdateCurrencyRateUseCase'),
  UpdateCurrencyMargin: Symbol.for('UpdateCurrencyMarginUseCase'),
  ToggleCurrencyActive: Symbol.for('ToggleCurrencyActiveUseCase'),
  DeleteCurrencyRate: Symbol.for('DeleteCurrencyRateUseCase'),
  SyncCurrency: Symbol.for('SyncCurrencyUseCase'),
  GenerateAllPrices: Symbol.for('GenerateAllPricesUseCase'),

  // Procurement
  TestProviderQuote: Symbol.for('TestProviderQuoteUseCase'),
  SearchProviders: Symbol.for('SearchProvidersUseCase'),
  ManageProviderOffer: Symbol.for('ManageProviderOfferUseCase'),
  IngestProviderCatalog: Symbol.for('IngestProviderCatalogUseCase'),
  IngestProviderCatalogStatus: Symbol.for('IngestProviderCatalogStatusUseCase'),
  RefreshProviderPrices: Symbol.for('RefreshProviderPricesUseCase'),
  ManualProviderPurchase: Symbol.for('ManualProviderPurchaseUseCase'),
  RecoverProviderOrder: Symbol.for('RecoverProviderOrderUseCase'),
  SearchCatalog: Symbol.for('SearchCatalogUseCase'),
  LinkCatalogProduct: Symbol.for('LinkCatalogProductUseCase'),
  LiveSearchProviders: Symbol.for('LiveSearchProvidersUseCase'),
  GetProcurementConfig: Symbol.for('GetProcurementConfigUseCase'),
  UpdateProcurementConfig: Symbol.for('UpdateProcurementConfigUseCase'),
  ListPurchaseQueue: Symbol.for('ListPurchaseQueueUseCase'),
  CancelQueueItem: Symbol.for('CancelQueueItemUseCase'),
  ListPurchaseAttempts: Symbol.for('ListPurchaseAttemptsUseCase'),

  // Price Match
  ListPriceMatchClaims: Symbol.for('ListPriceMatchClaimsUseCase'),
  GetPriceMatchClaimDetail: Symbol.for('GetPriceMatchClaimDetailUseCase'),
  GetPriceMatchClaimConfidence: Symbol.for('GetPriceMatchClaimConfidenceUseCase'),
  GetPriceMatchScreenshot: Symbol.for('GetPriceMatchScreenshotUseCase'),
  ApprovePriceMatch: Symbol.for('ApprovePriceMatchUseCase'),
  RejectPriceMatch: Symbol.for('RejectPriceMatchUseCase'),
  PreviewPriceMatchDiscount: Symbol.for('PreviewPriceMatchDiscountUseCase'),
  ListPriceMatchRetailers: Symbol.for('ListPriceMatchRetailersUseCase'),
  CreatePriceMatchRetailer: Symbol.for('CreatePriceMatchRetailerUseCase'),
  UpdatePriceMatchRetailer: Symbol.for('UpdatePriceMatchRetailerUseCase'),
  ListPriceMatchBlockedDomains: Symbol.for('ListPriceMatchBlockedDomainsUseCase'),
  CreatePriceMatchBlockedDomain: Symbol.for('CreatePriceMatchBlockedDomainUseCase'),
  UpdatePriceMatchBlockedDomain: Symbol.for('UpdatePriceMatchBlockedDomainUseCase'),
  GetPriceMatchConfig: Symbol.for('GetPriceMatchConfigUseCase'),
  UpdatePriceMatchConfig: Symbol.for('UpdatePriceMatchConfigUseCase'),

  // Referrals
  ListReferrals: Symbol.for('ListReferralsUseCase'),
  ListReferralLeaderboard: Symbol.for('ListReferralLeaderboardUseCase'),
  ResolveReferralDispute: Symbol.for('ResolveReferralDisputeUseCase'),
  InvalidateReferral: Symbol.for('InvalidateReferralUseCase'),
  PayLeaderboardPrizes: Symbol.for('PayLeaderboardPrizesUseCase'),

  // Reviews
  ListTrustpilotReviewClaims: Symbol.for('ListTrustpilotReviewClaimsUseCase'),
  ResolveTrustpilotReviewClaim: Symbol.for('ResolveTrustpilotReviewClaimUseCase'),

  // Analytics & Financial
  GetDashboardMetrics: Symbol.for('GetDashboardMetricsUseCase'),
  GetFinancialSummary: Symbol.for('GetFinancialSummaryUseCase'),
  GetTransactions: Symbol.for('GetTransactionsUseCase'),
  GetChannelsSnapshot: Symbol.for('GetChannelsSnapshotUseCase'),

  // Notifications
  SendBroadcastNotification: Symbol.for('SendBroadcastNotificationUseCase'),
  GetAdminUnseenCounts: Symbol.for('GetAdminUnseenCountsUseCase'),
  MarkAdminSectionSeen: Symbol.for('MarkAdminSectionSeenUseCase'),

  // Algolia
  GetAlgoliaIndexStats: Symbol.for('GetAlgoliaIndexStatsUseCase'),

  // Settings
  ListSettings: Symbol.for('ListSettingsUseCase'),
  UpdateSetting: Symbol.for('UpdateSettingUseCase'),
  GetPlatformSettings: Symbol.for('GetPlatformSettingsUseCase'),
  ListLanguages: Symbol.for('ListLanguagesUseCase'),
  CreateLanguage: Symbol.for('CreateLanguageUseCase'),
  UpdateLanguage: Symbol.for('UpdateLanguageUseCase'),
  ListCountries: Symbol.for('ListCountriesUseCase'),
  CreateCountry: Symbol.for('CreateCountryUseCase'),
  UpdateCountry: Symbol.for('UpdateCountryUseCase'),
  ListRegions: Symbol.for('ListRegionsUseCase'),
  CreateRegion: Symbol.for('CreateRegionUseCase'),
  UpdateRegion: Symbol.for('UpdateRegionUseCase'),
  GetRegionExcludedCountries: Symbol.for('GetRegionExcludedCountriesUseCase'),
  ListPlatformFamilies: Symbol.for('ListPlatformFamiliesUseCase'),
  CreatePlatformFamily: Symbol.for('CreatePlatformFamilyUseCase'),
  UpdatePlatformFamily: Symbol.for('UpdatePlatformFamilyUseCase'),
  DeletePlatformFamily: Symbol.for('DeletePlatformFamilyUseCase'),
  ListPlatforms: Symbol.for('ListPlatformsUseCase'),
  CreatePlatform: Symbol.for('CreatePlatformUseCase'),
  UpdatePlatform: Symbol.for('UpdatePlatformUseCase'),
  ListGenres: Symbol.for('ListGenresUseCase'),
  CreateGenre: Symbol.for('CreateGenreUseCase'),
  UpdateGenre: Symbol.for('UpdateGenreUseCase'),
  DeleteGenre: Symbol.for('DeleteGenreUseCase'),

  // Approval Workflow
  RequestAction: Symbol.for('RequestActionUseCase'),
  ApproveAction: Symbol.for('ApproveActionUseCase'),
  RejectAction: Symbol.for('RejectActionUseCase'),
  ListActionRequests: Symbol.for('ListActionRequestsUseCase'),

  // Audit
  ListAuditLog: Symbol.for('ListAuditLogUseCase'),

  // Verification
  ApproveVerification: Symbol.for('ApproveVerificationUseCase'),
  DenyVerification: Symbol.for('DenyVerificationUseCase'),

  // Admin Auth/SMS
  SendAdminSms: Symbol.for('SendAdminSmsUseCase'),
  VerifyAdminSms: Symbol.for('VerifyAdminSmsUseCase'),
  SendSecurityAlertSms: Symbol.for('SendSecurityAlertSmsUseCase'),

  // Digiseller
  DigisellerReconcileProfit: Symbol.for('DigisellerReconcileProfitUseCase'),

  // Opportunities
  ListOpportunities: Symbol.for('ListOpportunitiesUseCase'),

  // Alerts
  ListAlerts: Symbol.for('ListAlertsUseCase'),
  DismissAlert: Symbol.for('DismissAlertUseCase'),
  DismissAllAlerts: Symbol.for('DismissAllAlertsUseCase'),
  DismissAllByFilter: Symbol.for('DismissAllByFilterUseCase'),

  // Variant Price Timeline
  GetVariantPriceTimeline: Symbol.for('GetVariantPriceTimelineUseCase'),
  GetPricingSnapshot: Symbol.for('GetPricingSnapshotUseCase'),

  // Seller
  ListProviderAccounts: Symbol.for('ListProviderAccountsUseCase'),
  CreateProviderAccount: Symbol.for('CreateProviderAccountUseCase'),
  UpdateProviderAccount: Symbol.for('UpdateProviderAccountUseCase'),
  DeleteProviderAccount: Symbol.for('DeleteProviderAccountUseCase'),
  ListSellerListings: Symbol.for('ListSellerListingsUseCase'),
  GetVariantOffers: Symbol.for('GetVariantOffersUseCase'),
  CreateVariantOffer: Symbol.for('CreateVariantOfferUseCase'),
  UpdateVariantOffer: Symbol.for('UpdateVariantOfferUseCase'),
  DeleteVariantOffer: Symbol.for('DeleteVariantOfferUseCase'),
  CreateSellerListing: Symbol.for('CreateSellerListingUseCase'),
  UpdateSellerListingPrice: Symbol.for('UpdateSellerListingPriceUseCase'),
  ToggleSellerListingSync: Symbol.for('ToggleSellerListingSyncUseCase'),
  UpdateSellerListingMinPrice: Symbol.for('UpdateSellerListingMinPriceUseCase'),
  UpdateSellerListingOverrides: Symbol.for('UpdateSellerListingOverridesUseCase'),
  SetSellerListingVisibility: Symbol.for('SetSellerListingVisibilityUseCase'),
  DeactivateSellerListing: Symbol.for('DeactivateSellerListingUseCase'),
  UnlinkSellerListingMarketplaceProduct: Symbol.for('UnlinkSellerListingMarketplaceProductUseCase'),
  DeleteSellerListing: Symbol.for('DeleteSellerListingUseCase'),
  RecoverSellerListingHealth: Symbol.for('RecoverSellerListingHealthUseCase'),
  SyncSellerStock: Symbol.for('SyncSellerStockUseCase'),
  FetchRemoteStock: Symbol.for('FetchRemoteStockUseCase'),
  PublishSellerListingToMarketplace: Symbol.for('PublishSellerListingToMarketplaceUseCase'),
  BindSellerListingExternalAuction: Symbol.for('BindSellerListingExternalAuctionUseCase'),
  GetProviderAccountDetail: Symbol.for('GetProviderAccountDetailUseCase'),
  RegisterWebhooks: Symbol.for('RegisterWebhooksUseCase'),
  GetWebhookStatus: Symbol.for('GetWebhookStatusUseCase'),
  CalculatePayout: Symbol.for('CalculatePayoutUseCase'),
  GetCompetitors: Symbol.for('GetCompetitorsUseCase'),
  SuggestPrice: Symbol.for('SuggestPriceUseCase'),
  DryRunPricing: Symbol.for('DryRunPricingUseCase'),
  GetDecisionHistory: Symbol.for('GetDecisionHistoryUseCase'),
  GetLatestDecision: Symbol.for('GetLatestDecisionUseCase'),
  GetProviderDefaults: Symbol.for('GetProviderDefaultsUseCase'),
  BatchUpdatePrices: Symbol.for('BatchUpdatePricesUseCase'),
  BatchUpdateStock: Symbol.for('BatchUpdateStockUseCase'),
  UpdateGlobalStockStatus: Symbol.for('UpdateGlobalStockStatusUseCase'),
  EnableDeclaredStock: Symbol.for('EnableDeclaredStockUseCase'),
  EnableKeyReplacements: Symbol.for('EnableKeyReplacementsUseCase'),
  RemoveCallback: Symbol.for('RemoveCallbackUseCase'),
  ExpireReservations: Symbol.for('ExpireReservationsUseCase'),

  // Seller Webhooks
  HandleDeclaredStockReserve: Symbol.for('HandleDeclaredStockReserveUseCase'),
  HandleDeclaredStockProvide: Symbol.for('HandleDeclaredStockProvideUseCase'),
  HandleDeclaredStockCancel: Symbol.for('HandleDeclaredStockCancelUseCase'),
  HandleKeyUploadOrder: Symbol.for('HandleKeyUploadOrderUseCase'),
  HandleMarketplaceRefund: Symbol.for('HandleMarketplaceRefundUseCase'),
  HandleListingDeactivation: Symbol.for('HandleListingDeactivationUseCase'),
  HandleDigisellerDelivery: Symbol.for('HandleDigisellerDeliveryUseCase'),
  HandleDigisellerQuantityCheck: Symbol.for('HandleDigisellerQuantityCheckUseCase'),
  HandleInventoryCallback: Symbol.for('HandleInventoryCallbackUseCase'),
  HandleG2AReservation: Symbol.for('HandleG2AReservationUseCase'),
  HandleG2AOrder: Symbol.for('HandleG2AOrderUseCase'),
  HandleG2ARenewReservation: Symbol.for('HandleG2ARenewReservationUseCase'),
  HandleG2ACancelReservation: Symbol.for('HandleG2ACancelReservationUseCase'),
  HandleG2AGetInventory: Symbol.for('HandleG2AGetInventoryUseCase'),
  HandleG2AReturnInventory: Symbol.for('HandleG2AReturnInventoryUseCase'),
  HandleG2ANotifications: Symbol.for('HandleG2ANotificationsUseCase'),
  HandleGamivoReservation: Symbol.for('HandleGamivoReservationUseCase'),
  HandleGamivoOrder: Symbol.for('HandleGamivoOrderUseCase'),
  HandleGamivoGetKeys: Symbol.for('HandleGamivoGetKeysUseCase'),
  HandleGamivoRefund: Symbol.for('HandleGamivoRefundUseCase'),
  HandleGamivoOfferDeactivation: Symbol.for('HandleGamivoOfferDeactivationUseCase'),
  HandleKinguinWebhook: Symbol.for('HandleKinguinWebhookUseCase'),
  HandleKinguinBuyerWebhook: Symbol.for('HandleKinguinBuyerWebhookUseCase'),
  HandleBambooCallback: Symbol.for('HandleBambooCallbackUseCase'),

  // Products
  ListProducts: Symbol.for('ListProductsUseCase'),
  GetProduct: Symbol.for('GetProductUseCase'),
  CreateProduct: Symbol.for('CreateProductUseCase'),
  UpdateProduct: Symbol.for('UpdateProductUseCase'),
  DeleteProduct: Symbol.for('DeleteProductUseCase'),
  CreateVariant: Symbol.for('CreateVariantUseCase'),
  UpdateVariant: Symbol.for('UpdateVariantUseCase'),
  GetContentStatus: Symbol.for('GetContentStatusUseCase'),
  RegenerateContent: Symbol.for('RegenerateContentUseCase'),
} as const;
