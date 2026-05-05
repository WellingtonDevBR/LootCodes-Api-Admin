import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerPricingService } from '../../ports/seller-pricing.port.js';
import type { CompetitorPrice } from '../../ports/marketplace-adapter.port.js';
import type { CompetitorItem, GetCompetitorsDto, GetCompetitorsResult } from './seller-pricing.types.js';

function stampOwnership(
  competitors: CompetitorPrice[],
  ourExternalListingId: string | null | undefined,
): CompetitorPrice[] {
  const ours = ourExternalListingId?.trim();
  if (!ours) return competitors;
  return competitors.map((row) => {
    const id = row.externalListingId?.trim();
    if (id && id === ours) return { ...row, isOwnOffer: true };
    if (row.isOwnOffer === true) return row;
    return { ...row, isOwnOffer: false as const };
  });
}

@injectable()
export class GetCompetitorsUseCase {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.SellerPricingService) private pricingService: ISellerPricingService,
  ) {}

  async execute(dto: GetCompetitorsDto): Promise<GetCompetitorsResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const account = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: listing.provider_account_id as string },
    });
    const providerCode = (account?.provider_code as string) ?? '';
    const externalProductId = (listing.external_product_id as string) ?? '';
    const externalListingId = (listing.external_listing_id as string) ?? '';

    let competitors: CompetitorItem[];

    if (providerCode && externalProductId) {
      try {
        let live = await this.pricingService.getCompetitors(providerCode, externalProductId);
        live = stampOwnership(live, externalListingId);
        competitors = live.map((c) => ({
          merchant_name: c.merchantName,
          price_cents: c.priceCents,
          currency: c.currency,
          in_stock: c.inStock,
          is_own_offer: c.isOwnOffer ?? false,
        }));
      } catch {
        competitors = await this.getStoredSnapshots(dto.listing_id);
      }
    } else {
      competitors = await this.getStoredSnapshots(dto.listing_id);
    }

    const ownOffer = competitors.find((c) => c.is_own_offer);
    const inStockSorted = competitors.filter((c) => c.in_stock);
    let ownPosition: number | null = null;
    if (ownOffer) {
      const idx = inStockSorted.findIndex((c) => c.is_own_offer);
      ownPosition = idx >= 0 ? idx + 1 : null;
    }

    return {
      listing_id: dto.listing_id,
      competitors,
      own_position: ownPosition,
      own_price_cents: ownOffer?.price_cents ?? null,
    };
  }

  private async getStoredSnapshots(listingId: string): Promise<CompetitorItem[]> {
    const snapshots = await this.db.query<Record<string, unknown>>('seller_competitor_snapshots', {
      eq: [['seller_listing_id', listingId]],
      order: { column: 'price_cents', ascending: true },
    });

    return snapshots.map((s) => ({
      merchant_name: (s.merchant_name as string) ?? 'Unknown',
      price_cents: (s.price_cents as number) ?? 0,
      currency: (s.currency as string) ?? 'EUR',
      in_stock: (s.in_stock as boolean) ?? false,
      is_own_offer: (s.is_own_offer as boolean) ?? false,
    }));
  }
}
