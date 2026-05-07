/**
 * Marketplace adapter registry — resolves capability adapters by provider code.
 *
 * Each adapter implements a subset of the capability interfaces from
 * `marketplace-adapter.port.ts`. The registry uses runtime type checking
 * to verify capabilities. Populated by `bootstrapMarketplaceAdapters` on app startup.
 */
import { injectable } from 'tsyringe';
import type {
  IMarketplaceAdapterRegistry,
  ISellerListingAdapter,
  ISellerKeyUploadAdapter,
  ISellerDeclaredStockAdapter,
  ISellerStockSyncAdapter,
  ISellerPricingAdapter,
  ISellerCompetitionAdapter,
  ISellerCallbackSetupAdapter,
  ISellerBatchPriceAdapter,
  ISellerBatchDeclaredStockAdapter,
  ISellerGlobalStockAdapter,
  IProductSearchAdapter,
  MarketplaceCapability,
} from '../../core/ports/marketplace-adapter.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('marketplace-registry');

export type AnyMarketplaceAdapter = Partial<
  ISellerListingAdapter &
  ISellerKeyUploadAdapter &
  ISellerDeclaredStockAdapter &
  ISellerStockSyncAdapter &
  ISellerPricingAdapter &
  ISellerCompetitionAdapter &
  ISellerCallbackSetupAdapter &
  ISellerBatchPriceAdapter &
  ISellerBatchDeclaredStockAdapter &
  ISellerGlobalStockAdapter &
  IProductSearchAdapter
>;

type CapabilityCheckFn = (adapter: AnyMarketplaceAdapter) => boolean;

const CAPABILITY_CHECKS: Record<MarketplaceCapability, CapabilityCheckFn> = {
  listing: (a) => typeof a.createListing === 'function' && typeof a.deactivateListing === 'function',
  key_upload: (a) => typeof a.uploadKeys === 'function',
  declared_stock: (a) => typeof a.declareStock === 'function',
  stock_sync: (a) => typeof a.syncStockLevel === 'function',
  pricing: (a) => typeof a.calculateNetPayout === 'function',
  competition: (a) => typeof a.getCompetitorPrices === 'function',
  callback_setup: (a) => typeof a.registerCallback === 'function',
  batch_price: (a) => typeof a.batchUpdatePrices === 'function',
  batch_declared_stock: (a) => typeof a.batchUpdateDeclaredStock === 'function',
  global_stock: (a) => typeof a.updateAllStockStatus === 'function',
  product_search: (a) => typeof a.searchProducts === 'function',
};

@injectable()
export class MarketplaceAdapterRegistry implements IMarketplaceAdapterRegistry {
  private readonly adapters = new Map<string, AnyMarketplaceAdapter>();

  registerAdapter(providerCode: string, adapter: AnyMarketplaceAdapter): void {
    this.adapters.set(providerCode, adapter);
    logger.info('Registered marketplace adapter', { providerCode });
  }

  getListingAdapter(providerCode: string): ISellerListingAdapter | null {
    return this.getTypedAdapter<ISellerListingAdapter>(providerCode, 'listing');
  }

  getKeyUploadAdapter(providerCode: string): ISellerKeyUploadAdapter | null {
    return this.getTypedAdapter<ISellerKeyUploadAdapter>(providerCode, 'key_upload');
  }

  getDeclaredStockAdapter(providerCode: string): ISellerDeclaredStockAdapter | null {
    return this.getTypedAdapter<ISellerDeclaredStockAdapter>(providerCode, 'declared_stock');
  }

  getStockSyncAdapter(providerCode: string): ISellerStockSyncAdapter | null {
    return this.getTypedAdapter<ISellerStockSyncAdapter>(providerCode, 'stock_sync');
  }

  getPricingAdapter(providerCode: string): ISellerPricingAdapter | null {
    return this.getTypedAdapter<ISellerPricingAdapter>(providerCode, 'pricing');
  }

  getCompetitionAdapter(providerCode: string): ISellerCompetitionAdapter | null {
    return this.getTypedAdapter<ISellerCompetitionAdapter>(providerCode, 'competition');
  }

  getCallbackSetupAdapter(providerCode: string): ISellerCallbackSetupAdapter | null {
    return this.getTypedAdapter<ISellerCallbackSetupAdapter>(providerCode, 'callback_setup');
  }

  getBatchPriceAdapter(providerCode: string): ISellerBatchPriceAdapter | null {
    return this.getTypedAdapter<ISellerBatchPriceAdapter>(providerCode, 'batch_price');
  }

  getBatchDeclaredStockAdapter(providerCode: string): ISellerBatchDeclaredStockAdapter | null {
    return this.getTypedAdapter<ISellerBatchDeclaredStockAdapter>(providerCode, 'batch_declared_stock');
  }

  getGlobalStockAdapter(providerCode: string): ISellerGlobalStockAdapter | null {
    return this.getTypedAdapter<ISellerGlobalStockAdapter>(providerCode, 'global_stock');
  }

  getProductSearchAdapter(providerCode: string): IProductSearchAdapter | null {
    return this.getTypedAdapter<IProductSearchAdapter>(providerCode, 'product_search');
  }

  hasCapability(providerCode: string, capability: MarketplaceCapability): boolean {
    const adapter = this.adapters.get(providerCode);
    if (!adapter) return false;
    return CAPABILITY_CHECKS[capability](adapter);
  }

  getSupportedProviders(): string[] {
    return Array.from(this.adapters.keys());
  }

  private getTypedAdapter<T>(providerCode: string, capability: MarketplaceCapability): T | null {
    const adapter = this.adapters.get(providerCode);
    if (!adapter) return null;
    if (!CAPABILITY_CHECKS[capability](adapter)) return null;
    return adapter as unknown as T;
  }
}
