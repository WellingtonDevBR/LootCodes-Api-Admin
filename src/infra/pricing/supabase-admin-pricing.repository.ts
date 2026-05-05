import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminPricingRepository } from '../../core/ports/admin-pricing-repository.port.js';
import type {
  GetVariantPriceTimelineDto,
  GetVariantPriceTimelineResult,
  GetPricingSnapshotDto,
  GetPricingSnapshotResult,
  PricingSnapshotListing,
  PricingChannelFee,
} from '../../core/use-cases/pricing/pricing.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminPricingRepository');

const PERIOD_MAP: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

function periodToDays(period?: string): number {
  if (!period) return 7;
  if (PERIOD_MAP[period]) return PERIOD_MAP[period];
  const parsed = parseInt(period, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

interface SellerListingRow {
  id: string;
  variant_id: string;
  provider_account_id: string;
  price_cents: number;
  currency: string;
  status: string;
}

interface VariantRow {
  id: string;
  product_id: string;
  sku: string;
  price_usd: number;
  face_value: string | null;
  is_active: boolean;
}

interface ProductRow {
  id: string;
  name: string;
}

interface ProviderAccountRow {
  id: string;
  provider_code: string;
  display_name: string;
  seller_config: Record<string, unknown> | null;
}

interface KeyCountRow {
  variant_id: string;
  available_count: number;
}

const CHANNEL_NAME_MAP: Record<string, string> = {
  g2a: 'G2A',
  eneba: 'Eneba',
  gamivo: 'Gamivo',
  kinguin: 'Kinguin',
  digiseller: 'Digiseller',
};

@injectable()
export class SupabaseAdminPricingRepository implements IAdminPricingRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async getVariantPriceTimeline(dto: GetVariantPriceTimelineDto): Promise<GetVariantPriceTimelineResult> {
    const days = periodToDays(dto.period);
    logger.info('Fetching variant price timeline', { variantId: dto.variant_id, days });

    const timeline = await this.db.rpc<unknown[]>(
      'get_variant_price_timeline',
      {
        p_variant_id: dto.variant_id,
        p_days: days,
      },
    );

    return { timeline: timeline ?? [] };
  }

  async getPricingSnapshot(dto: GetPricingSnapshotDto): Promise<GetPricingSnapshotResult> {
    logger.info('Fetching pricing snapshot');

    const [sellerListings, providerAccounts] = await Promise.all([
      this.db.queryAll<SellerListingRow>('seller_listings', {
        select: 'id, variant_id, provider_account_id, price_cents, currency, status',
        eq: [['status', 'active']],
      }),
      this.db.query<ProviderAccountRow>('provider_accounts', {
        select: 'id, provider_code, display_name, seller_config',
        eq: [['is_enabled', true]],
      }),
    ]);

    if (sellerListings.length === 0) {
      return { listings: [], fees: this.buildFees(providerAccounts) };
    }

    const providerMap = new Map(providerAccounts.map(p => [p.id, p]));
    const variantIds = [...new Set(sellerListings.map(l => l.variant_id))];

    const variants = await this.db.query<VariantRow>('product_variants', {
      select: 'id, product_id, sku, price_usd, face_value, is_active',
      in: [['id', variantIds]],
    });
    const variantMap = new Map(variants.map(v => [v.id, v]));
    const productIds = [...new Set(variants.map(v => v.product_id))];

    const [products, keyCounts] = await Promise.all([
      this.db.query<ProductRow>('products', {
        select: 'id, name',
        in: [['id', productIds]],
      }),
      this.db.rpc<KeyCountRow[]>('get_batch_available_keys_count', {
        variant_uuids: variantIds,
      }).catch(() => [] as KeyCountRow[]),
    ]);

    const productMap = new Map(products.map(p => [p.id, p]));
    const stockMap = new Map<string, number>();
    if (Array.isArray(keyCounts)) {
      for (const k of keyCounts) stockMap.set(k.variant_id, k.available_count);
    }

    const grouped = new Map<string, {
      variant: VariantRow;
      product: ProductRow;
      prices: Record<string, { cents: number; currency: string }>;
    }>();

    for (const listing of sellerListings) {
      const variant = variantMap.get(listing.variant_id);
      if (!variant) continue;
      const product = productMap.get(variant.product_id);
      if (!product) continue;
      const provider = providerMap.get(listing.provider_account_id);
      if (!provider) continue;

      const channelName = CHANNEL_NAME_MAP[provider.provider_code.toLowerCase()] ?? provider.display_name;

      let entry = grouped.get(variant.id);
      if (!entry) {
        entry = { variant, product, prices: {} };
        grouped.set(variant.id, entry);
      }
      entry.prices[channelName] = {
        cents: listing.price_cents,
        currency: listing.currency,
      };
    }

    const limit = dto.limit ?? 200;
    const offset = dto.offset ?? 0;
    const allEntries = [...grouped.values()];
    const sliced = allEntries.slice(offset, offset + limit);

    const listings: PricingSnapshotListing[] = sliced.map(entry => {
      const { variant, product, prices } = entry;
      const variantLabel = variant.face_value
        ? `${product.name} — ${variant.face_value}`
        : product.name;

      return {
        productId: variant.id,
        name: variantLabel,
        sku: variant.sku ?? '',
        costBestCents: Math.round((variant.price_usd ?? 0) * 100),
        costCurrency: 'USD',
        stock: stockMap.get(variant.id) ?? 0,
        prices,
      };
    });

    return { listings, fees: this.buildFees(providerAccounts) };
  }

  private buildFees(accounts: ProviderAccountRow[]): PricingChannelFee[] {
    const fees: PricingChannelFee[] = [];
    for (const acc of accounts) {
      const channelName = CHANNEL_NAME_MAP[acc.provider_code.toLowerCase()] ?? acc.display_name;
      const config = acc.seller_config ?? {};
      const rate = typeof config.commission_rate_percent === 'number'
        ? config.commission_rate_percent / 100
        : 0;
      fees.push({ channel: channelName, feePercent: rate });
    }
    fees.push({ channel: 'Website', feePercent: 0 });
    return fees;
  }
}
