import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS, UC_TOKENS } from './tokens.js';

// Infrastructure adapters
import { SupabaseDbAdapter } from '../infra/database/supabase-db.adapter.js';
import { SupabaseStorageAdapter } from '../infra/storage/supabase-storage.adapter.js';
import { SupabaseAuthAdapter } from '../infra/auth/supabase-auth.adapter.js';
import { SupabaseAdminRoleAdapter } from '../infra/auth/supabase-admin-role.adapter.js';
import { SupabaseIpBlocklistAdapter } from '../infra/auth/supabase-ip-blocklist.adapter.js';
import { SupabaseAdminOrderRepository } from '../infra/orders/supabase-admin-order.repository.js';
import { SupabaseAdminSecurityRepository } from '../infra/security/supabase-admin-security.repository.js';
import { SupabaseAdminInventoryRepository } from '../infra/inventory/supabase-admin-inventory.repository.js';
import { SupabaseAdminUserRepository } from '../infra/users/supabase-admin-user.repository.js';
import { SupabaseAdminPromoRepository } from '../infra/promo/supabase-admin-promo.repository.js';
import { SupabaseAdminCurrencyRepository } from '../infra/currency/supabase-admin-currency.repository.js';
import { SupabaseAdminSupportRepository } from '../infra/support/supabase-admin-support.repository.js';
import { SupabaseAdminProcurementRepository } from '../infra/procurement/supabase-admin-procurement.repository.js';
import { BuyerManualPurchaseService } from '../infra/procurement/buyer-manual-purchase.service.js';
import { SupabaseAdminInventorySourceRepository } from '../infra/inventory-sources/supabase-admin-inventory-source.repository.js';
import { SupabaseAdminPriceMatchRepository } from '../infra/price-match/supabase-admin-price-match.repository.js';
import { SupabaseAdminReferralRepository } from '../infra/referrals/supabase-admin-referral.repository.js';
import { SupabaseAdminReviewRepository } from '../infra/reviews/supabase-admin-review.repository.js';
import { SupabaseAdminAnalyticsRepository } from '../infra/analytics/supabase-admin-analytics.repository.js';
import { SupabaseAdminNotificationRepository } from '../infra/notifications/supabase-admin-notification.repository.js';
import { SupabaseAdminAlgoliaRepository } from '../infra/algolia/supabase-admin-algolia.repository.js';
import { SupabaseAdminSettingsRepository } from '../infra/settings/supabase-admin-settings.repository.js';
import { SupabaseAdminApprovalRepository } from '../infra/approvals/supabase-admin-approval.repository.js';
import { SupabaseAdminAuditRepository } from '../infra/audit/supabase-admin-audit.repository.js';
import { SupabaseAdminVerificationRepository } from '../infra/verification/supabase-admin-verification.repository.js';
import { SupabaseAdminAuthSmsRepository } from '../infra/admin-auth/supabase-admin-auth-sms.repository.js';
import { SupabaseAdminDigisellerRepository } from '../infra/digiseller/supabase-admin-digiseller.repository.js';
import { SupabaseAdminPricingRepository } from '../infra/pricing/supabase-admin-pricing.repository.js';
import { SupabaseAdminProductRepository } from '../infra/products/supabase-admin-product.repository.js';
import { SupabaseAdminSellerRepository } from '../infra/seller/supabase-admin-seller.repository.js';
import { SupabaseAdminSellerPricingRepository } from '../infra/seller/supabase-admin-seller-pricing.repository.js';
import { SellerJitProcurementService } from '../infra/seller/seller-jit-procurement.service.js';
import { SellerKeyOperationsService } from '../infra/seller/seller-key-operations.service.js';
import { SellerDomainEventsService } from '../infra/seller/seller-domain-events.service.js';
import { KeyDecryptionService } from '../infra/crypto/key-decryption.service.js';
import { SecureKeyManagerAdapter } from '../infra/crypto/secure-key-manager.adapter.js';
import { SupabaseKeyRotationRepository } from '../infra/inventory/supabase-key-rotation.repository.js';
import { RecryptProductKeysBatchUseCase } from '../core/use-cases/inventory/recrypt-product-keys-batch.use-case.js';
import { BuyerProviderRegistry } from '../infra/procurement/buyer/buyer-provider-registry.js';
import { SupabaseProcurementFxConverter } from '../infra/currency/supabase-procurement-fx-converter.js';
import { SupabaseJitOfferRepository } from '../infra/procurement/supabase-jit-offer.repository.js';
import { RouteAndPurchaseJitOffersUseCase } from '../core/use-cases/procurement/route-and-purchase-jit-offers.use-case.js';
import {
  BuyerWalletSnapshotter,
  BambooWalletProbe,
  AppRouteWalletProbe,
} from '../infra/procurement/buyer/buyer-wallet-snapshotter.js';
import { CreditAwareDeclaredStockSelectorUseCase } from '../core/use-cases/seller/credit-aware-declared-stock-selector.use-case.js';
import { DtuClientFactory } from '../infra/procurement/dtu/dtu-client-factory.js';
import { DtuRechargeUseCase } from '../core/use-cases/procurement/dtu-recharge.use-case.js';
import { ListingHealthService } from '../infra/seller/listing-health.service.js';
import { VariantUnavailabilityService } from '../infra/seller/variant-unavailability.service.js';
import { MarketplaceAdapterRegistry } from '../infra/marketplace/marketplace-adapter-registry.js';
import { SellerPricingService } from '../infra/seller/pricing/seller-pricing.service.js';
import { SellerAutoPricingService } from '../infra/seller/pricing/seller-auto-pricing.service.js';
import { SellerPriceIntelligenceService } from '../infra/seller/pricing/seller-price-intelligence.service.js';
import { SellerCostBasisService } from '../infra/seller/pricing/seller-cost-basis.service.js';
import { SellerStockSyncService } from '../infra/seller/pricing/seller-stock-sync.service.js';
import { ProcurementDeclaredStockReconcileService } from '../infra/seller/procurement-declared-stock-reconcile.service.js';
import { SupabasePlatformSettingsRepository } from '../infra/platform-settings/supabase-platform-settings.repository.js';
import { SupabaseAdminOpportunitiesRepository } from '../infra/opportunities/supabase-admin-opportunities.repository.js';
import { SupabaseAdminAlertsRepository } from '../infra/alerts/supabase-admin-alerts.repository.js';

// Notification dispatcher & channels
import { NotificationDispatcher } from '../infra/notifications/notification-dispatcher.js';
import { AdminAlertChannel } from '../infra/notifications/channels/admin-alert.channel.js';
import { BrowserPushChannel } from '../infra/notifications/channels/browser-push.channel.js';
import { EmailChannel } from '../infra/notifications/channels/email.channel.js';
import { SlackChannel } from '../infra/notifications/channels/slack.channel.js';
import type { INotificationDispatcher } from '../core/ports/notification-channel.port.js';
import type { IDatabase } from '../core/ports/database.port.js';

// Use cases — Orders & Fulfillment
import { FulfillVerifiedOrderUseCase } from '../core/use-cases/orders/fulfill-verified-order.use-case.js';
import { ManualFulfillUseCase } from '../core/use-cases/orders/manual-fulfill.use-case.js';
import { RecoverOrderUseCase } from '../core/use-cases/orders/recover-order.use-case.js';
import { ConfirmPaymentUseCase } from '../core/use-cases/orders/confirm-payment.use-case.js';
import { ProcessPreorderUseCase } from '../core/use-cases/orders/process-preorder.use-case.js';
import { GenerateGuestAccessLinkUseCase } from '../core/use-cases/orders/generate-guest-access-link.use-case.js';
import { RefundOrderUseCase } from '../core/use-cases/orders/refund-order.use-case.js';
import { RefundTicketUseCase } from '../core/use-cases/orders/refund-ticket.use-case.js';
import { RefundInitiateUseCase } from '../core/use-cases/orders/refund-initiate.use-case.js';
import { ReissueEmailUseCase } from '../core/use-cases/orders/reissue-email.use-case.js';
import { ListOrdersUseCase } from '../core/use-cases/orders/list-orders.use-case.js';
import { GetOrderDetailUseCase } from '../core/use-cases/orders/get-order-detail.use-case.js';

// Use cases — Security & Fraud
import { GetSecurityConfigsUseCase } from '../core/use-cases/security/get-security-configs.use-case.js';
import { UpdateSecurityConfigUseCase } from '../core/use-cases/security/update-security-config.use-case.js';
import { UnlockRateLimitUseCase } from '../core/use-cases/security/unlock-rate-limit.use-case.js';
import { DirectUnlockRateLimitUseCase } from '../core/use-cases/security/direct-unlock-rate-limit.use-case.js';
import { BlockCustomerUseCase } from '../core/use-cases/security/block-customer.use-case.js';
import { ForceLogoutUseCase } from '../core/use-cases/security/force-logout.use-case.js';
import { ListRateLimitViolationsUseCase } from '../core/use-cases/security/list-rate-limit-violations.use-case.js';
import { ListRateLimitUnlocksUseCase } from '../core/use-cases/security/list-rate-limit-unlocks.use-case.js';
import { ListIpBlocklistUseCase } from '../core/use-cases/security/list-ip-blocklist.use-case.js';
import { AddIpBlockUseCase } from '../core/use-cases/security/add-ip-block.use-case.js';
import { RemoveIpBlockUseCase } from '../core/use-cases/security/remove-ip-block.use-case.js';
import { ListCustomerBlocklistUseCase } from '../core/use-cases/security/list-customer-blocklist.use-case.js';
import { RemoveCustomerBlockUseCase } from '../core/use-cases/security/remove-customer-block.use-case.js';
import { GetSurgeStateUseCase } from '../core/use-cases/security/get-surge-state.use-case.js';
import { GetPlatformSecuritySettingUseCase } from '../core/use-cases/security/get-platform-security-setting.use-case.js';
import { UpdatePlatformSecuritySettingUseCase } from '../core/use-cases/security/update-platform-security-setting.use-case.js';
import { ListSecurityAuditLogUseCase } from '../core/use-cases/security/list-security-audit-log.use-case.js';

// Use cases — Inventory & Keys
import { EmitInventoryStockChangedUseCase } from '../core/use-cases/inventory/emit-inventory-stock-changed.use-case.js';
import { SendStockNotificationsNowUseCase } from '../core/use-cases/inventory/send-stock-notifications-now.use-case.js';
import { ReplaceKeyUseCase } from '../core/use-cases/inventory/replace-key.use-case.js';
import { FixKeyStatesUseCase } from '../core/use-cases/inventory/fix-key-states.use-case.js';
import { UpdateAffectedKeyUseCase } from '../core/use-cases/inventory/update-affected-key.use-case.js';
import { DecryptKeysUseCase } from '../core/use-cases/inventory/decrypt-keys.use-case.js';
import { RecryptProductKeysUseCase } from '../core/use-cases/inventory/recrypt-product-keys.use-case.js';
import { SetKeysSalesBlockedUseCase } from '../core/use-cases/inventory/set-keys-sales-blocked.use-case.js';
import { SetVariantSalesBlockedUseCase } from '../core/use-cases/inventory/set-variant-sales-blocked.use-case.js';
import { MarkKeysFaultyUseCase } from '../core/use-cases/inventory/mark-keys-faulty.use-case.js';
import { LinkReplacementKeyUseCase } from '../core/use-cases/inventory/link-replacement-key.use-case.js';
import { ManualSellUseCase } from '../core/use-cases/inventory/manual-sell.use-case.js';
import { UpdateVariantPriceUseCase } from '../core/use-cases/inventory/update-variant-price.use-case.js';
import { GetInventoryCatalogUseCase } from '../core/use-cases/inventory/get-inventory-catalog.use-case.js';
import { GetVariantContextUseCase } from '../core/use-cases/inventory/get-variant-context.use-case.js';

// Use cases — Users
import { GetComprehensiveUserDataUseCase } from '../core/use-cases/users/get-comprehensive-user-data.use-case.js';
import { GetUserTimelineUseCase } from '../core/use-cases/users/get-user-timeline.use-case.js';
import { GetUserSessionsUseCase } from '../core/use-cases/users/get-user-sessions.use-case.js';
import { SearchAccountProfilesUseCase } from '../core/use-cases/users/search-account-profiles.use-case.js';
import { ToggleUserRoleUseCase } from '../core/use-cases/users/toggle-user-role.use-case.js';
import { DeleteUserAccountUseCase } from '../core/use-cases/users/delete-user-account.use-case.js';
import { ListCustomersUseCase } from '../core/use-cases/users/list-customers.use-case.js';

// Use cases — Promo Codes
import { CreatePromoCodeUseCase } from '../core/use-cases/promo/create-promo-code.use-case.js';
import { UpdatePromoCodeUseCase } from '../core/use-cases/promo/update-promo-code.use-case.js';
import { TogglePromoActiveUseCase } from '../core/use-cases/promo/toggle-promo-active.use-case.js';
import { DeletePromoCodeUseCase } from '../core/use-cases/promo/delete-promo-code.use-case.js';
import { SubmitPromoApprovalUseCase } from '../core/use-cases/promo/submit-promo-approval.use-case.js';
import { ApprovePromoCodeUseCase } from '../core/use-cases/promo/approve-promo-code.use-case.js';
import { RejectPromoCodeUseCase } from '../core/use-cases/promo/reject-promo-code.use-case.js';
import { SendPromoNotificationsUseCase } from '../core/use-cases/promo/send-promo-notifications.use-case.js';
import { EstimatePromoReachUseCase } from '../core/use-cases/promo/estimate-promo-reach.use-case.js';
import { ListPromoCodesUseCase } from '../core/use-cases/promo/list-promo-codes.use-case.js';
import { GetPromoUsageStatsUseCase } from '../core/use-cases/promo/get-promo-usage-stats.use-case.js';

// Use cases — Currency
import { GetCurrencyRatesUseCase } from '../core/use-cases/currency/get-currency-rates.use-case.js';
import { AddCurrencyRateUseCase } from '../core/use-cases/currency/add-currency-rate.use-case.js';
import { UpdateCurrencyRateUseCase } from '../core/use-cases/currency/update-currency-manual.use-case.js';
import { UpdateCurrencyMarginUseCase } from '../core/use-cases/currency/update-currency-margin.use-case.js';
import { ToggleCurrencyActiveUseCase } from '../core/use-cases/currency/toggle-currency-active.use-case.js';
import { DeleteCurrencyRateUseCase } from '../core/use-cases/currency/delete-currency-rate.use-case.js';
import { SyncCurrencyUseCase } from '../core/use-cases/currency/sync-currency.use-case.js';
import { GenerateAllPricesUseCase } from '../core/use-cases/currency/generate-all-prices.use-case.js';

// Use cases — Support
import { ListTicketsUseCase } from '../core/use-cases/support/list-tickets.use-case.js';
import { GetTicketUseCase } from '../core/use-cases/support/get-ticket.use-case.js';
import { UpdateTicketStatusUseCase } from '../core/use-cases/support/update-ticket-status.use-case.js';
import { UpdateTicketPriorityUseCase } from '../core/use-cases/support/update-ticket-priority.use-case.js';
import { AddTicketMessageUseCase } from '../core/use-cases/support/add-ticket-message.use-case.js';
import { ProcessTicketRefundUseCase } from '../core/use-cases/support/process-ticket-refund.use-case.js';

// Use cases — Inventory Sources
import { LinkVariantInventorySourceUseCase } from '../core/use-cases/inventory-sources/link-variant-inventory-source.use-case.js';
import { UnlinkVariantInventorySourceUseCase } from '../core/use-cases/inventory-sources/unlink-variant-inventory-source.use-case.js';
import { ListVariantInventorySourcesUseCase } from '../core/use-cases/inventory-sources/list-variant-inventory-sources.use-case.js';
import { ListLinkableInventorySourcesUseCase } from '../core/use-cases/inventory-sources/list-linkable-inventory-sources.use-case.js';

// Use cases — Price Match
import { ListPriceMatchClaimsUseCase } from '../core/use-cases/price-match/list-price-match-claims.use-case.js';
import { GetPriceMatchClaimDetailUseCase } from '../core/use-cases/price-match/get-price-match-claim-detail.use-case.js';
import { GetPriceMatchClaimConfidenceUseCase } from '../core/use-cases/price-match/get-price-match-claim-confidence.use-case.js';
import { GetPriceMatchScreenshotUseCase } from '../core/use-cases/price-match/get-price-match-screenshot.use-case.js';
import { ApprovePriceMatchUseCase } from '../core/use-cases/price-match/approve-price-match.use-case.js';
import { RejectPriceMatchUseCase } from '../core/use-cases/price-match/reject-price-match.use-case.js';
import { PreviewPriceMatchDiscountUseCase } from '../core/use-cases/price-match/preview-price-match-discount.use-case.js';
import { ListPriceMatchRetailersUseCase } from '../core/use-cases/price-match/list-price-match-retailers.use-case.js';
import { CreatePriceMatchRetailerUseCase } from '../core/use-cases/price-match/create-price-match-retailer.use-case.js';
import { UpdatePriceMatchRetailerUseCase } from '../core/use-cases/price-match/update-price-match-retailer.use-case.js';
import { ListPriceMatchBlockedDomainsUseCase } from '../core/use-cases/price-match/list-price-match-blocked-domains.use-case.js';
import { CreatePriceMatchBlockedDomainUseCase } from '../core/use-cases/price-match/create-price-match-blocked-domain.use-case.js';
import { UpdatePriceMatchBlockedDomainUseCase } from '../core/use-cases/price-match/update-price-match-blocked-domain.use-case.js';
import { GetPriceMatchConfigUseCase } from '../core/use-cases/price-match/get-price-match-config.use-case.js';
import { UpdatePriceMatchConfigUseCase } from '../core/use-cases/price-match/update-price-match-config.use-case.js';
import { ExpirePriceMatchClaimsUseCase } from '../core/use-cases/price-match/expire-price-match-claims.use-case.js';
import { ProcessPriceDropRefundsUseCase } from '../core/use-cases/price-match/process-price-drop-refunds.use-case.js';

// Use cases — Referrals
import { ListReferralsUseCase } from '../core/use-cases/referrals/list-referrals.use-case.js';
import { ListReferralLeaderboardUseCase } from '../core/use-cases/referrals/list-referral-leaderboard.use-case.js';
import { ResolveReferralDisputeUseCase } from '../core/use-cases/referrals/resolve-referral-dispute.use-case.js';
import { InvalidateReferralUseCase } from '../core/use-cases/referrals/invalidate-referral.use-case.js';
import { PayLeaderboardPrizesUseCase } from '../core/use-cases/referrals/pay-leaderboard-prizes.use-case.js';
import { SettlePendingReferralsUseCase } from '../core/use-cases/referrals/settle-pending-referrals.use-case.js';

// Use cases — Reviews
import { ListTrustpilotReviewClaimsUseCase } from '../core/use-cases/reviews/list-trustpilot-review-claims.use-case.js';
import { ResolveTrustpilotReviewClaimUseCase } from '../core/use-cases/reviews/resolve-trustpilot-review-claim.use-case.js';

// Use cases — Analytics
import { GetDashboardMetricsUseCase } from '../core/use-cases/analytics/get-dashboard-metrics.use-case.js';
import { GetFinancialSummaryUseCase } from '../core/use-cases/analytics/get-financial-summary.use-case.js';
import { GetTransactionsUseCase } from '../core/use-cases/analytics/get-transactions.use-case.js';
import { GetChannelsSnapshotUseCase } from '../core/use-cases/analytics/get-channels-snapshot.use-case.js';

// Use cases — Notifications
import { SendBroadcastNotificationUseCase } from '../core/use-cases/notifications/send-broadcast-notification.use-case.js';
import { GetAdminUnseenCountsUseCase } from '../core/use-cases/notifications/get-admin-unseen-counts.use-case.js';
import { MarkAdminSectionSeenUseCase } from '../core/use-cases/notifications/mark-admin-section-seen.use-case.js';

// Use cases — Algolia
import { GetAlgoliaIndexStatsUseCase } from '../core/use-cases/algolia/get-algolia-index-stats.use-case.js';

// Use cases — Settings
import { ListSettingsUseCase } from '../core/use-cases/settings/list-settings.use-case.js';
import { UpdateSettingUseCase } from '../core/use-cases/settings/update-setting.use-case.js';
import { GetPlatformSettingsUseCase } from '../core/use-cases/settings/get-platform-settings.use-case.js';
import { ListLanguagesUseCase } from '../core/use-cases/settings/list-languages.use-case.js';
import { CreateLanguageUseCase } from '../core/use-cases/settings/create-language.use-case.js';
import { UpdateLanguageUseCase } from '../core/use-cases/settings/update-language.use-case.js';
import { ListCountriesUseCase } from '../core/use-cases/settings/list-countries.use-case.js';
import { CreateCountryUseCase } from '../core/use-cases/settings/create-country.use-case.js';
import { UpdateCountryUseCase } from '../core/use-cases/settings/update-country.use-case.js';
import { ListRegionsUseCase } from '../core/use-cases/settings/list-regions.use-case.js';
import { CreateRegionUseCase } from '../core/use-cases/settings/create-region.use-case.js';
import { UpdateRegionUseCase } from '../core/use-cases/settings/update-region.use-case.js';
import { GetRegionExcludedCountriesUseCase } from '../core/use-cases/settings/get-region-excluded-countries.use-case.js';
import { ListPlatformFamiliesUseCase } from '../core/use-cases/settings/list-platform-families.use-case.js';
import { CreatePlatformFamilyUseCase } from '../core/use-cases/settings/create-platform-family.use-case.js';
import { UpdatePlatformFamilyUseCase } from '../core/use-cases/settings/update-platform-family.use-case.js';
import { DeletePlatformFamilyUseCase } from '../core/use-cases/settings/delete-platform-family.use-case.js';
import { ListPlatformsUseCase } from '../core/use-cases/settings/list-platforms.use-case.js';
import { CreatePlatformUseCase } from '../core/use-cases/settings/create-platform.use-case.js';
import { UpdatePlatformUseCase } from '../core/use-cases/settings/update-platform.use-case.js';
import { ListGenresUseCase } from '../core/use-cases/settings/list-genres.use-case.js';
import { CreateGenreUseCase } from '../core/use-cases/settings/create-genre.use-case.js';
import { UpdateGenreUseCase } from '../core/use-cases/settings/update-genre.use-case.js';
import { DeleteGenreUseCase } from '../core/use-cases/settings/delete-genre.use-case.js';

// Use cases — Approvals
import { RequestActionUseCase } from '../core/use-cases/approvals/request-action.use-case.js';
import { ApproveActionUseCase } from '../core/use-cases/approvals/approve-action.use-case.js';
import { RejectActionUseCase } from '../core/use-cases/approvals/reject-action.use-case.js';
import { ListActionRequestsUseCase } from '../core/use-cases/approvals/list-action-requests.use-case.js';

// Use cases — Audit
import { ListAuditLogUseCase } from '../core/use-cases/audit/list-audit-log.use-case.js';

// Use cases — Verification
import { ApproveVerificationUseCase } from '../core/use-cases/verification/approve-verification.use-case.js';
import { DenyVerificationUseCase } from '../core/use-cases/verification/deny-verification.use-case.js';

// Use cases — Admin Auth/SMS
import { SendAdminSmsUseCase } from '../core/use-cases/admin-auth/send-admin-sms.use-case.js';
import { VerifyAdminSmsUseCase } from '../core/use-cases/admin-auth/verify-admin-sms.use-case.js';
import { SendSecurityAlertSmsUseCase } from '../core/use-cases/admin-auth/send-security-alert-sms.use-case.js';

// Use cases — Digiseller
import { DigisellerReconcileProfitUseCase } from '../core/use-cases/digiseller/reconcile-profit.use-case.js';

// Use cases — Pricing
import { GetVariantPriceTimelineUseCase } from '../core/use-cases/pricing/get-variant-price-timeline.use-case.js';
import { GetPricingSnapshotUseCase } from '../core/use-cases/pricing/get-pricing-snapshot.use-case.js';

// Use cases — Seller
import { ListProviderAccountsUseCase } from '../core/use-cases/seller/list-provider-accounts.use-case.js';
import { CreateProviderAccountUseCase } from '../core/use-cases/seller/create-provider-account.use-case.js';
import { UpdateProviderAccountUseCase } from '../core/use-cases/seller/update-provider-account.use-case.js';
import { DeleteProviderAccountUseCase } from '../core/use-cases/seller/delete-provider-account.use-case.js';
import { ListSellerListingsUseCase } from '../core/use-cases/seller/list-seller-listings.use-case.js';
import { GetVariantOffersUseCase } from '../core/use-cases/seller/get-variant-offers.use-case.js';
import { CreateVariantOfferUseCase } from '../core/use-cases/seller/create-variant-offer.use-case.js';
import { UpdateVariantOfferUseCase } from '../core/use-cases/seller/update-variant-offer.use-case.js';
import { DeleteVariantOfferUseCase } from '../core/use-cases/seller/delete-variant-offer.use-case.js';
import { CreateSellerListingUseCase } from '../core/use-cases/seller/create-seller-listing.use-case.js';
import { UpdateSellerListingPriceUseCase } from '../core/use-cases/seller/update-seller-listing-price.use-case.js';
import { ToggleSellerListingSyncUseCase } from '../core/use-cases/seller/toggle-seller-listing-sync.use-case.js';
import { UpdateSellerListingMinPriceUseCase } from '../core/use-cases/seller/update-seller-listing-min-price.use-case.js';
import { UpdateSellerListingOverridesUseCase } from '../core/use-cases/seller/update-seller-listing-overrides.use-case.js';
import { SetSellerListingVisibilityUseCase } from '../core/use-cases/seller/set-seller-listing-visibility.use-case.js';
import { DeactivateSellerListingUseCase } from '../core/use-cases/seller/deactivate-seller-listing.use-case.js';
import { UnlinkSellerListingMarketplaceProductUseCase } from '../core/use-cases/seller/unlink-seller-listing-marketplace-product.use-case.js';
import { DeleteSellerListingUseCase } from '../core/use-cases/seller/delete-seller-listing.use-case.js';
import { RecoverSellerListingHealthUseCase } from '../core/use-cases/seller/recover-seller-listing-health.use-case.js';
import { SyncSellerStockUseCase } from '../core/use-cases/seller/sync-seller-stock.use-case.js';
import { SetSellerListingDeclaredStockUseCase } from '../core/use-cases/seller/set-seller-listing-declared-stock.use-case.js';
import { FetchRemoteStockUseCase } from '../core/use-cases/seller/fetch-remote-stock.use-case.js';
import { PublishSellerListingToMarketplaceUseCase } from '../core/use-cases/seller/publish-seller-listing-to-marketplace.use-case.js';
import { ComputeJitPublishPlanUseCase } from '../core/use-cases/seller/compute-jit-publish-plan.use-case.js';
import { BindSellerListingExternalAuctionUseCase } from '../core/use-cases/seller/bind-seller-listing-external-auction.use-case.js';
import { GetProviderAccountDetailUseCase } from '../core/use-cases/seller/get-provider-account-detail.use-case.js';
import { RegisterWebhooksUseCase } from '../core/use-cases/seller/register-webhooks.use-case.js';
import { GetWebhookStatusUseCase } from '../core/use-cases/seller/get-webhook-status.use-case.js';
import { CalculatePayoutUseCase } from '../core/use-cases/seller/calculate-payout.use-case.js';
import { GetCompetitorsUseCase } from '../core/use-cases/seller/get-competitors.use-case.js';
import { SuggestPriceUseCase } from '../core/use-cases/seller/suggest-price.use-case.js';
import { DryRunPricingUseCase } from '../core/use-cases/seller/dry-run-pricing.use-case.js';
import { GetDecisionHistoryUseCase } from '../core/use-cases/seller/get-decision-history.use-case.js';
import { GetLatestDecisionUseCase } from '../core/use-cases/seller/get-latest-decision.use-case.js';
import { GetProviderDefaultsUseCase } from '../core/use-cases/seller/get-provider-defaults.use-case.js';
import { BatchUpdatePricesUseCase } from '../core/use-cases/seller/batch-update-prices.use-case.js';
import { BatchUpdateStockUseCase } from '../core/use-cases/seller/batch-update-stock.use-case.js';
import { UpdateGlobalStockStatusUseCase } from '../core/use-cases/seller/update-global-stock-status.use-case.js';
import { EnableDeclaredStockUseCase } from '../core/use-cases/seller/enable-declared-stock.use-case.js';
import { EnableKeyReplacementsUseCase } from '../core/use-cases/seller/enable-key-replacements.use-case.js';
import { RemoveCallbackUseCase } from '../core/use-cases/seller/remove-callback.use-case.js';
import { ExpireReservationsUseCase } from '../core/use-cases/seller/expire-reservations.use-case.js';
import { ReconcileSellerListingsUseCase } from '../core/use-cases/seller/reconcile-seller-listings.use-case.js';
import { SyncSellerListingPausedAlertsUseCase } from '../core/use-cases/seller/sync-seller-listing-paused-alerts.use-case.js';

// Use cases — Seller Webhooks
import { HandleDeclaredStockReserveUseCase } from '../core/use-cases/seller-webhook/eneba/handle-declared-stock-reserve.use-case.js';
import { HandleDeclaredStockProvideUseCase } from '../core/use-cases/seller-webhook/eneba/handle-declared-stock-provide.use-case.js';
import { HandleDeclaredStockCancelUseCase } from '../core/use-cases/seller-webhook/eneba/handle-declared-stock-cancel.use-case.js';
import { HandleKeyUploadOrderUseCase } from '../core/use-cases/seller-webhook/handle-key-upload-order.use-case.js';
import { HandleMarketplaceRefundUseCase } from '../core/use-cases/seller-webhook/handle-marketplace-refund.use-case.js';
import { HandleListingDeactivationUseCase } from '../core/use-cases/seller-webhook/handle-listing-deactivation.use-case.js';
import { HandleDigisellerDeliveryUseCase } from '../core/use-cases/seller-webhook/digiseller/handle-digiseller-delivery.use-case.js';
import { HandleDigisellerQuantityCheckUseCase } from '../core/use-cases/seller-webhook/digiseller/handle-digiseller-quantity-check.use-case.js';
import { HandleInventoryCallbackUseCase } from '../core/use-cases/seller-webhook/handle-inventory-callback.use-case.js';
import { HandleG2AReservationUseCase } from '../core/use-cases/seller-webhook/g2a/handle-g2a-reservation.use-case.js';
import { HandleG2AOrderUseCase } from '../core/use-cases/seller-webhook/g2a/handle-g2a-order.use-case.js';
import { HandleG2ARenewReservationUseCase } from '../core/use-cases/seller-webhook/g2a/handle-g2a-renew-reservation.use-case.js';
import { HandleG2ACancelReservationUseCase } from '../core/use-cases/seller-webhook/g2a/handle-g2a-cancel-reservation.use-case.js';
import { HandleG2AGetInventoryUseCase } from '../core/use-cases/seller-webhook/g2a/handle-g2a-get-inventory.use-case.js';
import { HandleG2AReturnInventoryUseCase } from '../core/use-cases/seller-webhook/g2a/handle-g2a-return-inventory.use-case.js';
import { HandleG2ANotificationsUseCase } from '../core/use-cases/seller-webhook/g2a/handle-g2a-notifications.use-case.js';
import { HandleGamivoReservationUseCase } from '../core/use-cases/seller-webhook/gamivo/handle-gamivo-reservation.use-case.js';
import { HandleGamivoOrderUseCase } from '../core/use-cases/seller-webhook/gamivo/handle-gamivo-order.use-case.js';
import { HandleGamivoGetKeysUseCase } from '../core/use-cases/seller-webhook/gamivo/handle-gamivo-get-keys.use-case.js';
import { HandleGamivoRefundUseCase } from '../core/use-cases/seller-webhook/gamivo/handle-gamivo-refund.use-case.js';
import { HandleGamivoOfferDeactivationUseCase } from '../core/use-cases/seller-webhook/gamivo/handle-gamivo-offer-deactivation.use-case.js';
import { HandleKinguinWebhookUseCase } from '../core/use-cases/seller-webhook/kinguin/handle-kinguin-webhook.use-case.js';
import { HandleKinguinBuyerWebhookUseCase } from '../core/use-cases/seller-webhook/kinguin/handle-kinguin-buyer-webhook.use-case.js';
import { HandleBambooCallbackUseCase } from '../core/use-cases/seller-webhook/bamboo/handle-bamboo-callback.use-case.js';
import { KinguinKeyUploadService } from '../infra/seller/kinguin-key-upload.service.js';

// Use cases — Products
import { ListProductsUseCase } from '../core/use-cases/products/list-products.use-case.js';
import { GetProductUseCase } from '../core/use-cases/products/get-product.use-case.js';
import { CreateProductUseCase } from '../core/use-cases/products/create-product.use-case.js';
import { UpdateProductUseCase } from '../core/use-cases/products/update-product.use-case.js';
import { DeleteProductUseCase } from '../core/use-cases/products/delete-product.use-case.js';
import { CreateVariantUseCase } from '../core/use-cases/products/create-variant.use-case.js';
import { UpdateVariantUseCase } from '../core/use-cases/products/update-variant.use-case.js';
import { GetContentStatusUseCase } from '../core/use-cases/products/get-content-status.use-case.js';
import { RegenerateContentUseCase } from '../core/use-cases/products/regenerate-content.use-case.js';

// Use cases — Procurement
import { TestProviderQuoteUseCase } from '../core/use-cases/procurement/test-provider-quote.use-case.js';
import { SearchProvidersUseCase } from '../core/use-cases/procurement/search-providers.use-case.js';
import { ManageProviderOfferUseCase } from '../core/use-cases/procurement/manage-provider-offer.use-case.js';
import { IngestProviderCatalogUseCase } from '../core/use-cases/procurement/ingest-provider-catalog.use-case.js';
import { IngestProviderCatalogStatusUseCase } from '../core/use-cases/procurement/ingest-provider-catalog-status.use-case.js';
import { RefreshProviderPricesUseCase } from '../core/use-cases/procurement/refresh-provider-prices.use-case.js';
import { ManualProviderPurchaseUseCase } from '../core/use-cases/procurement/manual-provider-purchase.use-case.js';
import { RecoverProviderOrderUseCase } from '../core/use-cases/procurement/recover-provider-order.use-case.js';
import { SearchCatalogUseCase } from '../core/use-cases/procurement/search-catalog.use-case.js';
import { LinkCatalogProductUseCase } from '../core/use-cases/procurement/link-catalog-product.use-case.js';
import { LiveSearchProvidersUseCase } from '../core/use-cases/procurement/live-search-providers.use-case.js';
import { GetProcurementConfigUseCase } from '../core/use-cases/procurement/get-procurement-config.use-case.js';
import { UpdateProcurementConfigUseCase } from '../core/use-cases/procurement/update-procurement-config.use-case.js';
import { ListPurchaseQueueUseCase } from '../core/use-cases/procurement/list-purchase-queue.use-case.js';
import { CancelQueueItemUseCase } from '../core/use-cases/procurement/cancel-queue-item.use-case.js';
import { ListPurchaseAttemptsUseCase } from '../core/use-cases/procurement/list-purchase-attempts.use-case.js';

// Use cases — Opportunities
import { ListOpportunitiesUseCase } from '../core/use-cases/opportunities/list-opportunities.use-case.js';

// Use cases — Alerts
import { ListAlertsUseCase } from '../core/use-cases/alerts/list-alerts.use-case.js';
import { DismissAlertUseCase } from '../core/use-cases/alerts/dismiss-alert.use-case.js';
import { DismissAllAlertsUseCase } from '../core/use-cases/alerts/dismiss-all-alerts.use-case.js';
import { DismissAllByFilterUseCase } from '../core/use-cases/alerts/dismiss-all-by-filter.use-case.js';

// Core infrastructure ports
container.register(TOKENS.Database, { useClass: SupabaseDbAdapter });
container.register(TOKENS.Storage, { useClass: SupabaseStorageAdapter });
container.register(TOKENS.AuthProvider, { useClass: SupabaseAuthAdapter });
container.register(TOKENS.AdminRoleChecker, { useClass: SupabaseAdminRoleAdapter });
container.register(TOKENS.IpBlocklist, { useClass: SupabaseIpBlocklistAdapter });

// Domain repositories
container.register(TOKENS.AdminOrderRepository, { useClass: SupabaseAdminOrderRepository });
container.register(TOKENS.AdminSecurityRepository, { useClass: SupabaseAdminSecurityRepository });
container.register(TOKENS.AdminInventoryRepository, { useClass: SupabaseAdminInventoryRepository });
container.register(TOKENS.AdminUserRepository, { useClass: SupabaseAdminUserRepository });
container.register(TOKENS.AdminPromoRepository, { useClass: SupabaseAdminPromoRepository });
container.register(TOKENS.AdminCurrencyRepository, { useClass: SupabaseAdminCurrencyRepository });
container.register(TOKENS.AdminSupportRepository, { useClass: SupabaseAdminSupportRepository });
container.register(TOKENS.AdminProcurementRepository, { useClass: SupabaseAdminProcurementRepository });
container.register(TOKENS.BuyerManualPurchaseService, { useClass: BuyerManualPurchaseService });
container.register(TOKENS.SellerJitProcurementService, { useClass: SellerJitProcurementService });
container.register(TOKENS.AdminInventorySourceRepository, { useClass: SupabaseAdminInventorySourceRepository });
container.register(TOKENS.AdminPriceMatchRepository, { useClass: SupabaseAdminPriceMatchRepository });
container.register(TOKENS.AdminReferralRepository, { useClass: SupabaseAdminReferralRepository });
container.register(TOKENS.AdminReviewRepository, { useClass: SupabaseAdminReviewRepository });
container.register(TOKENS.AdminAnalyticsRepository, { useClass: SupabaseAdminAnalyticsRepository });
container.register(TOKENS.AdminNotificationRepository, { useClass: SupabaseAdminNotificationRepository });
container.register(TOKENS.AdminAlgoliaRepository, { useClass: SupabaseAdminAlgoliaRepository });
container.register(TOKENS.AdminSettingsRepository, { useClass: SupabaseAdminSettingsRepository });
container.register(TOKENS.AdminApprovalRepository, { useClass: SupabaseAdminApprovalRepository });
container.register(TOKENS.AdminAuditRepository, { useClass: SupabaseAdminAuditRepository });
container.register(TOKENS.AdminVerificationRepository, { useClass: SupabaseAdminVerificationRepository });
container.register(TOKENS.AdminAuthSmsRepository, { useClass: SupabaseAdminAuthSmsRepository });
container.register(TOKENS.AdminDigisellerRepository, { useClass: SupabaseAdminDigisellerRepository });
container.register(TOKENS.AdminPricingRepository, { useClass: SupabaseAdminPricingRepository });
container.register(TOKENS.AdminProductRepository, { useClass: SupabaseAdminProductRepository });
container.register(TOKENS.AdminSellerRepository, { useClass: SupabaseAdminSellerRepository });
container.register(TOKENS.AdminSellerPricingRepository, { useClass: SupabaseAdminSellerPricingRepository });
container.register(TOKENS.AdminOpportunitiesRepository, { useClass: SupabaseAdminOpportunitiesRepository });
container.register(TOKENS.AdminAlertsRepository, { useClass: SupabaseAdminAlertsRepository });

// Notification dispatcher (singleton so all channels are shared)
container.registerSingleton(TOKENS.NotificationDispatcher, NotificationDispatcher);

// Wire notification channels into the dispatcher
const notificationDispatcher = container.resolve<INotificationDispatcher>(TOKENS.NotificationDispatcher);
const notificationDb = container.resolve<IDatabase>(TOKENS.Database);
notificationDispatcher.register(new AdminAlertChannel(notificationDb));
notificationDispatcher.register(new BrowserPushChannel(notificationDb));
notificationDispatcher.register(new EmailChannel(notificationDb));
notificationDispatcher.register(new SlackChannel(notificationDb));

// Use cases — Orders & Fulfillment
container.register(UC_TOKENS.FulfillVerifiedOrder, { useClass: FulfillVerifiedOrderUseCase });
container.register(UC_TOKENS.ManualFulfill, { useClass: ManualFulfillUseCase });
container.register(UC_TOKENS.RecoverOrder, { useClass: RecoverOrderUseCase });
container.register(UC_TOKENS.ConfirmPayment, { useClass: ConfirmPaymentUseCase });
container.register(UC_TOKENS.ProcessPreorder, { useClass: ProcessPreorderUseCase });
container.register(UC_TOKENS.GenerateGuestAccessLink, { useClass: GenerateGuestAccessLinkUseCase });
container.register(UC_TOKENS.RefundOrder, { useClass: RefundOrderUseCase });
container.register(UC_TOKENS.RefundTicket, { useClass: RefundTicketUseCase });
container.register(UC_TOKENS.RefundInitiate, { useClass: RefundInitiateUseCase });
container.register(UC_TOKENS.ReissueEmail, { useClass: ReissueEmailUseCase });
container.register(UC_TOKENS.ListOrders, { useClass: ListOrdersUseCase });
container.register(UC_TOKENS.GetOrderDetail, { useClass: GetOrderDetailUseCase });

// Use cases — Security & Fraud
container.register(UC_TOKENS.GetSecurityConfigs, { useClass: GetSecurityConfigsUseCase });
container.register(UC_TOKENS.UpdateSecurityConfig, { useClass: UpdateSecurityConfigUseCase });
container.register(UC_TOKENS.UnlockRateLimit, { useClass: UnlockRateLimitUseCase });
container.register(UC_TOKENS.DirectUnlockRateLimit, { useClass: DirectUnlockRateLimitUseCase });
container.register(UC_TOKENS.BlockCustomer, { useClass: BlockCustomerUseCase });
container.register(UC_TOKENS.ForceLogout, { useClass: ForceLogoutUseCase });
container.register(UC_TOKENS.ListRateLimitViolations, { useClass: ListRateLimitViolationsUseCase });
container.register(UC_TOKENS.ListRateLimitUnlocks, { useClass: ListRateLimitUnlocksUseCase });
container.register(UC_TOKENS.ListIpBlocklist, { useClass: ListIpBlocklistUseCase });
container.register(UC_TOKENS.AddIpBlock, { useClass: AddIpBlockUseCase });
container.register(UC_TOKENS.RemoveIpBlock, { useClass: RemoveIpBlockUseCase });
container.register(UC_TOKENS.ListCustomerBlocklist, { useClass: ListCustomerBlocklistUseCase });
container.register(UC_TOKENS.RemoveCustomerBlock, { useClass: RemoveCustomerBlockUseCase });
container.register(UC_TOKENS.GetSurgeState, { useClass: GetSurgeStateUseCase });
container.register(UC_TOKENS.GetPlatformSecuritySetting, { useClass: GetPlatformSecuritySettingUseCase });
container.register(UC_TOKENS.UpdatePlatformSecuritySetting, { useClass: UpdatePlatformSecuritySettingUseCase });
container.register(UC_TOKENS.ListSecurityAuditLog, { useClass: ListSecurityAuditLogUseCase });

// Use cases — Inventory & Keys
container.register(UC_TOKENS.EmitInventoryStockChanged, { useClass: EmitInventoryStockChangedUseCase });
container.register(UC_TOKENS.SendStockNotificationsNow, { useClass: SendStockNotificationsNowUseCase });
container.register(UC_TOKENS.ReplaceKey, { useClass: ReplaceKeyUseCase });
container.register(UC_TOKENS.FixKeyStates, { useClass: FixKeyStatesUseCase });
container.register(UC_TOKENS.UpdateAffectedKey, { useClass: UpdateAffectedKeyUseCase });
container.register(UC_TOKENS.DecryptKeys, { useClass: DecryptKeysUseCase });
container.register(UC_TOKENS.RecryptProductKeys, { useClass: RecryptProductKeysUseCase });
container.register(UC_TOKENS.SetKeysSalesBlocked, { useClass: SetKeysSalesBlockedUseCase });
container.register(UC_TOKENS.SetVariantSalesBlocked, { useClass: SetVariantSalesBlockedUseCase });
container.register(UC_TOKENS.MarkKeysFaulty, { useClass: MarkKeysFaultyUseCase });
container.register(UC_TOKENS.LinkReplacementKey, { useClass: LinkReplacementKeyUseCase });
container.register(UC_TOKENS.ManualSell, { useClass: ManualSellUseCase });
container.register(UC_TOKENS.UpdateVariantPrice, { useClass: UpdateVariantPriceUseCase });
container.register(UC_TOKENS.GetInventoryCatalog, { useClass: GetInventoryCatalogUseCase });
container.register(UC_TOKENS.GetVariantContext, { useClass: GetVariantContextUseCase });

// Use cases — Users
container.register(UC_TOKENS.GetComprehensiveUserData, { useClass: GetComprehensiveUserDataUseCase });
container.register(UC_TOKENS.GetUserTimeline, { useClass: GetUserTimelineUseCase });
container.register(UC_TOKENS.GetUserSessions, { useClass: GetUserSessionsUseCase });
container.register(UC_TOKENS.SearchAccountProfiles, { useClass: SearchAccountProfilesUseCase });
container.register(UC_TOKENS.ToggleUserRole, { useClass: ToggleUserRoleUseCase });
container.register(UC_TOKENS.DeleteUserAccount, { useClass: DeleteUserAccountUseCase });
container.register(UC_TOKENS.ListCustomers, { useClass: ListCustomersUseCase });

// Use cases — Promo Codes
container.register(UC_TOKENS.CreatePromoCode, { useClass: CreatePromoCodeUseCase });
container.register(UC_TOKENS.UpdatePromoCode, { useClass: UpdatePromoCodeUseCase });
container.register(UC_TOKENS.TogglePromoActive, { useClass: TogglePromoActiveUseCase });
container.register(UC_TOKENS.DeletePromoCode, { useClass: DeletePromoCodeUseCase });
container.register(UC_TOKENS.SubmitPromoApproval, { useClass: SubmitPromoApprovalUseCase });
container.register(UC_TOKENS.ApprovePromoCode, { useClass: ApprovePromoCodeUseCase });
container.register(UC_TOKENS.RejectPromoCode, { useClass: RejectPromoCodeUseCase });
container.register(UC_TOKENS.SendPromoNotifications, { useClass: SendPromoNotificationsUseCase });
container.register(UC_TOKENS.EstimatePromoReach, { useClass: EstimatePromoReachUseCase });
container.register(UC_TOKENS.ListPromoCodes, { useClass: ListPromoCodesUseCase });
container.register(UC_TOKENS.GetPromoUsageStats, { useClass: GetPromoUsageStatsUseCase });

// Use cases — Currency
container.register(UC_TOKENS.GetCurrencyRates, { useClass: GetCurrencyRatesUseCase });
container.register(UC_TOKENS.AddCurrencyRate, { useClass: AddCurrencyRateUseCase });
container.register(UC_TOKENS.UpdateCurrencyRate, { useClass: UpdateCurrencyRateUseCase });
container.register(UC_TOKENS.UpdateCurrencyMargin, { useClass: UpdateCurrencyMarginUseCase });
container.register(UC_TOKENS.ToggleCurrencyActive, { useClass: ToggleCurrencyActiveUseCase });
container.register(UC_TOKENS.DeleteCurrencyRate, { useClass: DeleteCurrencyRateUseCase });
container.register(UC_TOKENS.SyncCurrency, { useClass: SyncCurrencyUseCase });
container.register(UC_TOKENS.GenerateAllPrices, { useClass: GenerateAllPricesUseCase });

// Use cases — Support
container.register(UC_TOKENS.ListTickets, { useClass: ListTicketsUseCase });
container.register(UC_TOKENS.GetTicket, { useClass: GetTicketUseCase });
container.register(UC_TOKENS.UpdateTicketStatus, { useClass: UpdateTicketStatusUseCase });
container.register(UC_TOKENS.UpdateTicketPriority, { useClass: UpdateTicketPriorityUseCase });
container.register(UC_TOKENS.AddTicketMessage, { useClass: AddTicketMessageUseCase });
container.register(UC_TOKENS.ProcessTicketRefund, { useClass: ProcessTicketRefundUseCase });

// Use cases — Procurement
container.register(UC_TOKENS.TestProviderQuote, { useClass: TestProviderQuoteUseCase });
container.register(UC_TOKENS.SearchProviders, { useClass: SearchProvidersUseCase });
container.register(UC_TOKENS.ManageProviderOffer, { useClass: ManageProviderOfferUseCase });
container.register(UC_TOKENS.IngestProviderCatalog, { useClass: IngestProviderCatalogUseCase });
container.register(UC_TOKENS.IngestProviderCatalogStatus, { useClass: IngestProviderCatalogStatusUseCase });
container.register(UC_TOKENS.RefreshProviderPrices, { useClass: RefreshProviderPricesUseCase });
container.register(UC_TOKENS.ManualProviderPurchase, { useClass: ManualProviderPurchaseUseCase });
container.register(UC_TOKENS.RecoverProviderOrder, { useClass: RecoverProviderOrderUseCase });
container.register(UC_TOKENS.SearchCatalog, { useClass: SearchCatalogUseCase });
container.register(UC_TOKENS.LinkCatalogProduct, { useClass: LinkCatalogProductUseCase });
container.register(UC_TOKENS.LiveSearchProviders, { useClass: LiveSearchProvidersUseCase });
container.register(UC_TOKENS.GetProcurementConfig, { useClass: GetProcurementConfigUseCase });
container.register(UC_TOKENS.UpdateProcurementConfig, { useClass: UpdateProcurementConfigUseCase });
container.register(UC_TOKENS.ListPurchaseQueue, { useClass: ListPurchaseQueueUseCase });
container.register(UC_TOKENS.CancelQueueItem, { useClass: CancelQueueItemUseCase });
container.register(UC_TOKENS.ListPurchaseAttempts, { useClass: ListPurchaseAttemptsUseCase });

// Use cases — Opportunities
container.register(UC_TOKENS.ListOpportunities, { useClass: ListOpportunitiesUseCase });

// Use cases — Alerts
container.register(UC_TOKENS.ListAlerts, { useClass: ListAlertsUseCase });
container.register(UC_TOKENS.DismissAlert, { useClass: DismissAlertUseCase });
container.register(UC_TOKENS.DismissAllAlerts, { useClass: DismissAllAlertsUseCase });
container.register(UC_TOKENS.DismissAllByFilter, { useClass: DismissAllByFilterUseCase });

// Use cases — Inventory Sources
container.register(UC_TOKENS.LinkVariantInventorySource, { useClass: LinkVariantInventorySourceUseCase });
container.register(UC_TOKENS.UnlinkVariantInventorySource, { useClass: UnlinkVariantInventorySourceUseCase });
container.register(UC_TOKENS.ListVariantInventorySources, { useClass: ListVariantInventorySourcesUseCase });
container.register(UC_TOKENS.ListLinkableInventorySources, { useClass: ListLinkableInventorySourcesUseCase });

// Use cases — Price Match
container.register(UC_TOKENS.ListPriceMatchClaims, { useClass: ListPriceMatchClaimsUseCase });
container.register(UC_TOKENS.GetPriceMatchClaimDetail, { useClass: GetPriceMatchClaimDetailUseCase });
container.register(UC_TOKENS.GetPriceMatchClaimConfidence, { useClass: GetPriceMatchClaimConfidenceUseCase });
container.register(UC_TOKENS.GetPriceMatchScreenshot, { useClass: GetPriceMatchScreenshotUseCase });
container.register(UC_TOKENS.ApprovePriceMatch, { useClass: ApprovePriceMatchUseCase });
container.register(UC_TOKENS.RejectPriceMatch, { useClass: RejectPriceMatchUseCase });
container.register(UC_TOKENS.PreviewPriceMatchDiscount, { useClass: PreviewPriceMatchDiscountUseCase });
container.register(UC_TOKENS.ListPriceMatchRetailers, { useClass: ListPriceMatchRetailersUseCase });
container.register(UC_TOKENS.CreatePriceMatchRetailer, { useClass: CreatePriceMatchRetailerUseCase });
container.register(UC_TOKENS.UpdatePriceMatchRetailer, { useClass: UpdatePriceMatchRetailerUseCase });
container.register(UC_TOKENS.ListPriceMatchBlockedDomains, { useClass: ListPriceMatchBlockedDomainsUseCase });
container.register(UC_TOKENS.CreatePriceMatchBlockedDomain, { useClass: CreatePriceMatchBlockedDomainUseCase });
container.register(UC_TOKENS.UpdatePriceMatchBlockedDomain, { useClass: UpdatePriceMatchBlockedDomainUseCase });
container.register(UC_TOKENS.GetPriceMatchConfig, { useClass: GetPriceMatchConfigUseCase });
container.register(UC_TOKENS.UpdatePriceMatchConfig, { useClass: UpdatePriceMatchConfigUseCase });
container.register(UC_TOKENS.ExpirePriceMatchClaims, { useClass: ExpirePriceMatchClaimsUseCase });
container.register(UC_TOKENS.ProcessPriceDropRefunds, { useClass: ProcessPriceDropRefundsUseCase });

// Use cases — Referrals
container.register(UC_TOKENS.ListReferrals, { useClass: ListReferralsUseCase });
container.register(UC_TOKENS.ListReferralLeaderboard, { useClass: ListReferralLeaderboardUseCase });
container.register(UC_TOKENS.ResolveReferralDispute, { useClass: ResolveReferralDisputeUseCase });
container.register(UC_TOKENS.InvalidateReferral, { useClass: InvalidateReferralUseCase });
container.register(UC_TOKENS.PayLeaderboardPrizes, { useClass: PayLeaderboardPrizesUseCase });
container.register(UC_TOKENS.SettlePendingReferrals, { useClass: SettlePendingReferralsUseCase });

// Use cases — Reviews
container.register(UC_TOKENS.ListTrustpilotReviewClaims, { useClass: ListTrustpilotReviewClaimsUseCase });
container.register(UC_TOKENS.ResolveTrustpilotReviewClaim, { useClass: ResolveTrustpilotReviewClaimUseCase });

// Use cases — Analytics
container.register(UC_TOKENS.GetDashboardMetrics, { useClass: GetDashboardMetricsUseCase });
container.register(UC_TOKENS.GetFinancialSummary, { useClass: GetFinancialSummaryUseCase });
container.register(UC_TOKENS.GetTransactions, { useClass: GetTransactionsUseCase });
container.register(UC_TOKENS.GetChannelsSnapshot, { useClass: GetChannelsSnapshotUseCase });

// Use cases — Notifications
container.register(UC_TOKENS.SendBroadcastNotification, { useClass: SendBroadcastNotificationUseCase });
container.register(UC_TOKENS.GetAdminUnseenCounts, { useClass: GetAdminUnseenCountsUseCase });
container.register(UC_TOKENS.MarkAdminSectionSeen, { useClass: MarkAdminSectionSeenUseCase });

// Use cases — Algolia
container.register(UC_TOKENS.GetAlgoliaIndexStats, { useClass: GetAlgoliaIndexStatsUseCase });

// Use cases — Settings
container.register(UC_TOKENS.ListSettings, { useClass: ListSettingsUseCase });
container.register(UC_TOKENS.UpdateSetting, { useClass: UpdateSettingUseCase });
container.register(UC_TOKENS.GetPlatformSettings, { useClass: GetPlatformSettingsUseCase });
container.register(UC_TOKENS.ListLanguages, { useClass: ListLanguagesUseCase });
container.register(UC_TOKENS.CreateLanguage, { useClass: CreateLanguageUseCase });
container.register(UC_TOKENS.UpdateLanguage, { useClass: UpdateLanguageUseCase });
container.register(UC_TOKENS.ListCountries, { useClass: ListCountriesUseCase });
container.register(UC_TOKENS.CreateCountry, { useClass: CreateCountryUseCase });
container.register(UC_TOKENS.UpdateCountry, { useClass: UpdateCountryUseCase });
container.register(UC_TOKENS.ListRegions, { useClass: ListRegionsUseCase });
container.register(UC_TOKENS.CreateRegion, { useClass: CreateRegionUseCase });
container.register(UC_TOKENS.UpdateRegion, { useClass: UpdateRegionUseCase });
container.register(UC_TOKENS.GetRegionExcludedCountries, { useClass: GetRegionExcludedCountriesUseCase });
container.register(UC_TOKENS.ListPlatformFamilies, { useClass: ListPlatformFamiliesUseCase });
container.register(UC_TOKENS.CreatePlatformFamily, { useClass: CreatePlatformFamilyUseCase });
container.register(UC_TOKENS.UpdatePlatformFamily, { useClass: UpdatePlatformFamilyUseCase });
container.register(UC_TOKENS.DeletePlatformFamily, { useClass: DeletePlatformFamilyUseCase });
container.register(UC_TOKENS.ListPlatforms, { useClass: ListPlatformsUseCase });
container.register(UC_TOKENS.CreatePlatform, { useClass: CreatePlatformUseCase });
container.register(UC_TOKENS.UpdatePlatform, { useClass: UpdatePlatformUseCase });
container.register(UC_TOKENS.ListGenres, { useClass: ListGenresUseCase });
container.register(UC_TOKENS.CreateGenre, { useClass: CreateGenreUseCase });
container.register(UC_TOKENS.UpdateGenre, { useClass: UpdateGenreUseCase });
container.register(UC_TOKENS.DeleteGenre, { useClass: DeleteGenreUseCase });

// Use cases — Approvals
container.register(UC_TOKENS.RequestAction, { useClass: RequestActionUseCase });
container.register(UC_TOKENS.ApproveAction, { useClass: ApproveActionUseCase });
container.register(UC_TOKENS.RejectAction, { useClass: RejectActionUseCase });
container.register(UC_TOKENS.ListActionRequests, { useClass: ListActionRequestsUseCase });

// Use cases — Audit
container.register(UC_TOKENS.ListAuditLog, { useClass: ListAuditLogUseCase });

// Use cases — Verification
container.register(UC_TOKENS.ApproveVerification, { useClass: ApproveVerificationUseCase });
container.register(UC_TOKENS.DenyVerification, { useClass: DenyVerificationUseCase });

// Use cases — Admin Auth/SMS
container.register(UC_TOKENS.SendAdminSms, { useClass: SendAdminSmsUseCase });
container.register(UC_TOKENS.VerifyAdminSms, { useClass: VerifyAdminSmsUseCase });
container.register(UC_TOKENS.SendSecurityAlertSms, { useClass: SendSecurityAlertSmsUseCase });

// Use cases — Digiseller
container.register(UC_TOKENS.DigisellerReconcileProfit, { useClass: DigisellerReconcileProfitUseCase });

// Use cases — Pricing
container.register(UC_TOKENS.GetVariantPriceTimeline, { useClass: GetVariantPriceTimelineUseCase });
container.register(UC_TOKENS.GetPricingSnapshot, { useClass: GetPricingSnapshotUseCase });

// Use cases — Seller
container.register(UC_TOKENS.ListProviderAccounts, { useClass: ListProviderAccountsUseCase });
container.register(UC_TOKENS.CreateProviderAccount, { useClass: CreateProviderAccountUseCase });
container.register(UC_TOKENS.UpdateProviderAccount, { useClass: UpdateProviderAccountUseCase });
container.register(UC_TOKENS.DeleteProviderAccount, { useClass: DeleteProviderAccountUseCase });
container.register(UC_TOKENS.ListSellerListings, { useClass: ListSellerListingsUseCase });
container.register(UC_TOKENS.GetVariantOffers, { useClass: GetVariantOffersUseCase });
container.register(UC_TOKENS.CreateVariantOffer, { useClass: CreateVariantOfferUseCase });
container.register(UC_TOKENS.UpdateVariantOffer, { useClass: UpdateVariantOfferUseCase });
container.register(UC_TOKENS.DeleteVariantOffer, { useClass: DeleteVariantOfferUseCase });
container.register(UC_TOKENS.CreateSellerListing, { useClass: CreateSellerListingUseCase });
container.register(UC_TOKENS.UpdateSellerListingPrice, { useClass: UpdateSellerListingPriceUseCase });
container.register(UC_TOKENS.ToggleSellerListingSync, { useClass: ToggleSellerListingSyncUseCase });
container.register(UC_TOKENS.UpdateSellerListingMinPrice, { useClass: UpdateSellerListingMinPriceUseCase });
container.register(UC_TOKENS.UpdateSellerListingOverrides, { useClass: UpdateSellerListingOverridesUseCase });
container.register(UC_TOKENS.SetSellerListingVisibility, { useClass: SetSellerListingVisibilityUseCase });
container.register(UC_TOKENS.DeactivateSellerListing, { useClass: DeactivateSellerListingUseCase });
container.register(UC_TOKENS.UnlinkSellerListingMarketplaceProduct, { useClass: UnlinkSellerListingMarketplaceProductUseCase });
container.register(UC_TOKENS.DeleteSellerListing, { useClass: DeleteSellerListingUseCase });
container.register(UC_TOKENS.RecoverSellerListingHealth, { useClass: RecoverSellerListingHealthUseCase });
container.register(UC_TOKENS.SyncSellerStock, { useClass: SyncSellerStockUseCase });
container.register(UC_TOKENS.SetSellerListingDeclaredStock, {
  useClass: SetSellerListingDeclaredStockUseCase,
});
container.register(UC_TOKENS.FetchRemoteStock, { useClass: FetchRemoteStockUseCase });
container.register(UC_TOKENS.ComputeJitPublishPlan, { useClass: ComputeJitPublishPlanUseCase });
container.register(UC_TOKENS.PublishSellerListingToMarketplace, { useClass: PublishSellerListingToMarketplaceUseCase });
container.register(UC_TOKENS.BindSellerListingExternalAuction, { useClass: BindSellerListingExternalAuctionUseCase });
container.register(UC_TOKENS.GetProviderAccountDetail, { useClass: GetProviderAccountDetailUseCase });
container.register(UC_TOKENS.RegisterWebhooks, { useClass: RegisterWebhooksUseCase });
container.register(UC_TOKENS.GetWebhookStatus, { useClass: GetWebhookStatusUseCase });
container.register(UC_TOKENS.CalculatePayout, { useClass: CalculatePayoutUseCase });
container.register(UC_TOKENS.GetCompetitors, { useClass: GetCompetitorsUseCase });
container.register(UC_TOKENS.SuggestPrice, { useClass: SuggestPriceUseCase });
container.register(UC_TOKENS.DryRunPricing, { useClass: DryRunPricingUseCase });
container.register(UC_TOKENS.GetDecisionHistory, { useClass: GetDecisionHistoryUseCase });
container.register(UC_TOKENS.GetLatestDecision, { useClass: GetLatestDecisionUseCase });
container.register(UC_TOKENS.GetProviderDefaults, { useClass: GetProviderDefaultsUseCase });
container.register(UC_TOKENS.BatchUpdatePrices, { useClass: BatchUpdatePricesUseCase });
container.register(UC_TOKENS.BatchUpdateStock, { useClass: BatchUpdateStockUseCase });
container.register(UC_TOKENS.UpdateGlobalStockStatus, { useClass: UpdateGlobalStockStatusUseCase });
container.register(UC_TOKENS.EnableDeclaredStock, { useClass: EnableDeclaredStockUseCase });
container.register(UC_TOKENS.EnableKeyReplacements, { useClass: EnableKeyReplacementsUseCase });
container.register(UC_TOKENS.RemoveCallback, { useClass: RemoveCallbackUseCase });
container.register(UC_TOKENS.ExpireReservations, { useClass: ExpireReservationsUseCase });
container.register(UC_TOKENS.SyncSellerListingPausedAlerts, { useClass: SyncSellerListingPausedAlertsUseCase });
container.register(UC_TOKENS.ReconcileSellerListings, { useClass: ReconcileSellerListingsUseCase });

// Infrastructure — Marketplace & Seller Services
// Singleton: tsyringe defaults to Transient; bootstrap and repositories must share one registry.
container.registerSingleton(TOKENS.MarketplaceAdapterRegistry, MarketplaceAdapterRegistry);
container.register(TOKENS.KeyDecryption, { useClass: KeyDecryptionService });
container.register(TOKENS.KeyEncryptionPort, { useClass: SecureKeyManagerAdapter });
container.register(TOKENS.KeyRotationRepository, { useClass: SupabaseKeyRotationRepository });
container.register(UC_TOKENS.RecryptProductKeysBatch, { useClass: RecryptProductKeysBatchUseCase });

// Buyer-side procurement routing (multi-provider JIT)
container.register(TOKENS.JitOfferRepository, { useClass: SupabaseJitOfferRepository });
container.register(TOKENS.ProcurementFxConverter, { useClass: SupabaseProcurementFxConverter });
container.register(TOKENS.BuyerProviderRegistry, { useClass: BuyerProviderRegistry });
container.register(UC_TOKENS.RouteAndPurchaseJitOffers, { useClass: RouteAndPurchaseJitOffersUseCase });

// Wallet snapshot + credit-aware declared-stock selector
container.register(TOKENS.BuyerWalletSnapshotter, {
  useFactory: (c) => {
    const db = c.resolve<IDatabase>(TOKENS.Database);
    return new BuyerWalletSnapshotter(db, [new BambooWalletProbe(db), new AppRouteWalletProbe(db)]);
  },
});
container.register(TOKENS.CreditAwareDeclaredStockSelector, {
  useClass: CreditAwareDeclaredStockSelectorUseCase,
});

// DTU (Direct Top-Up)
container.register(TOKENS.DtuClientFactory, { useClass: DtuClientFactory });
container.register(UC_TOKENS.DtuRecharge, { useClass: DtuRechargeUseCase });
container.register(TOKENS.ListingHealth, { useClass: ListingHealthService });
container.register(TOKENS.VariantUnavailability, { useClass: VariantUnavailabilityService });
container.register(TOKENS.SellerKeyOperations, { useClass: SellerKeyOperationsService });
container.register(TOKENS.SellerDomainEvents, { useClass: SellerDomainEventsService });
container.register(TOKENS.KinguinKeyUpload, { useClass: KinguinKeyUploadService });

// Seller pricing services
container.register(TOKENS.SellerCostBasisService, { useClass: SellerCostBasisService });
container.register(TOKENS.SellerPriceIntelligenceService, { useClass: SellerPriceIntelligenceService });
container.register(TOKENS.SellerPricingService, { useClass: SellerPricingService });
container.register(TOKENS.SellerAutoPricingService, { useClass: SellerAutoPricingService });
container.register(TOKENS.SellerStockSyncService, { useClass: SellerStockSyncService });
container.register(TOKENS.ProcurementDeclaredStockReconcileService, {
  useClass: ProcurementDeclaredStockReconcileService,
});
container.register(TOKENS.PlatformSettingsRepository, { useClass: SupabasePlatformSettingsRepository });

// Use cases — Seller Webhooks
container.register(UC_TOKENS.HandleDeclaredStockReserve, { useClass: HandleDeclaredStockReserveUseCase });
container.register(UC_TOKENS.HandleDeclaredStockProvide, { useClass: HandleDeclaredStockProvideUseCase });
container.register(UC_TOKENS.HandleDeclaredStockCancel, { useClass: HandleDeclaredStockCancelUseCase });
container.register(UC_TOKENS.HandleKeyUploadOrder, { useClass: HandleKeyUploadOrderUseCase });
container.register(UC_TOKENS.HandleMarketplaceRefund, { useClass: HandleMarketplaceRefundUseCase });
container.register(UC_TOKENS.HandleListingDeactivation, { useClass: HandleListingDeactivationUseCase });
container.register(UC_TOKENS.HandleDigisellerDelivery, { useClass: HandleDigisellerDeliveryUseCase });
container.register(UC_TOKENS.HandleDigisellerQuantityCheck, { useClass: HandleDigisellerQuantityCheckUseCase });
container.register(UC_TOKENS.HandleInventoryCallback, { useClass: HandleInventoryCallbackUseCase });
container.register(UC_TOKENS.HandleG2AReservation, { useClass: HandleG2AReservationUseCase });
container.register(UC_TOKENS.HandleG2AOrder, { useClass: HandleG2AOrderUseCase });
container.register(UC_TOKENS.HandleG2ARenewReservation, { useClass: HandleG2ARenewReservationUseCase });
container.register(UC_TOKENS.HandleG2ACancelReservation, { useClass: HandleG2ACancelReservationUseCase });
container.register(UC_TOKENS.HandleG2AGetInventory, { useClass: HandleG2AGetInventoryUseCase });
container.register(UC_TOKENS.HandleG2AReturnInventory, { useClass: HandleG2AReturnInventoryUseCase });
container.register(UC_TOKENS.HandleG2ANotifications, { useClass: HandleG2ANotificationsUseCase });
container.register(UC_TOKENS.HandleGamivoReservation, { useClass: HandleGamivoReservationUseCase });
container.register(UC_TOKENS.HandleGamivoOrder, { useClass: HandleGamivoOrderUseCase });
container.register(UC_TOKENS.HandleGamivoGetKeys, { useClass: HandleGamivoGetKeysUseCase });
container.register(UC_TOKENS.HandleGamivoRefund, { useClass: HandleGamivoRefundUseCase });
container.register(UC_TOKENS.HandleGamivoOfferDeactivation, { useClass: HandleGamivoOfferDeactivationUseCase });
container.register(UC_TOKENS.HandleKinguinWebhook, { useClass: HandleKinguinWebhookUseCase });
container.register(UC_TOKENS.HandleKinguinBuyerWebhook, { useClass: HandleKinguinBuyerWebhookUseCase });
container.register(UC_TOKENS.HandleBambooCallback, { useClass: HandleBambooCallbackUseCase });

// Use cases — Products
container.register(UC_TOKENS.ListProducts, { useClass: ListProductsUseCase });
container.register(UC_TOKENS.GetProduct, { useClass: GetProductUseCase });
container.register(UC_TOKENS.CreateProduct, { useClass: CreateProductUseCase });
container.register(UC_TOKENS.UpdateProduct, { useClass: UpdateProductUseCase });
container.register(UC_TOKENS.DeleteProduct, { useClass: DeleteProductUseCase });
container.register(UC_TOKENS.CreateVariant, { useClass: CreateVariantUseCase });
container.register(UC_TOKENS.UpdateVariant, { useClass: UpdateVariantUseCase });
container.register(UC_TOKENS.GetContentStatus, { useClass: GetContentStatusUseCase });
container.register(UC_TOKENS.RegenerateContent, { useClass: RegenerateContentUseCase });

export { container };
