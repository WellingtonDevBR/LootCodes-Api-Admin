export interface TestProviderQuoteDto { variant_id: string; provider_code?: string; admin_id: string }
export interface TestProviderQuoteResult { quotes: Array<{ provider: string; price_cents: number; available: boolean }> }

export interface SearchProvidersDto { query: string; limit?: number }
export interface SearchProvidersResult { providers: unknown[] }

export interface ManageProviderOfferDto { variant_id: string; provider_code: string; action: 'link' | 'unlink' | 'update'; offer_data?: Record<string, unknown>; admin_id: string }
export interface ManageProviderOfferResult { success: boolean }

export interface IngestProviderCatalogDto { provider_code: string; admin_id: string }
export interface IngestProviderCatalogResult { job_id: string; status: string }

export interface IngestProviderCatalogStatusDto { job_id: string }
export interface IngestProviderCatalogStatusResult { job_id: string; status: string; progress?: number; error?: string }

export interface RefreshProviderPricesDto { provider_code?: string; admin_id: string }
export interface RefreshProviderPricesResult { success: boolean; prices_updated: number }

export interface ManualProviderPurchaseDto { variant_id: string; provider_code: string; quantity: number; admin_id: string }
export interface ManualProviderPurchaseResult { success: boolean; purchase_id?: string }

export interface RecoverProviderOrderDto { purchase_id: string; admin_id: string }
export interface RecoverProviderOrderResult { success: boolean; new_status: string }
