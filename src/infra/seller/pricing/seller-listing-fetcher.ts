/**
 * Seller listing fetcher — owns the two read paths used by the auto-pricing
 * cron orchestrator:
 *
 *   - {@link getAutoSyncPriceListings} — active listings with auto_sync_price=true
 *     (the subset the pricing cron touches).
 *   - {@link getActiveListings} — every active listing (the superset that the
 *     cost-basis refresh runs over, even when auto-pricing is off).
 *
 * The class enriches each row with the `provider_code` from `provider_accounts`
 * (the cron groups by `provider_code` to apply marketplace-level concurrency)
 * and normalizes the nullable JSONB columns (`provider_metadata`,
 * `pricing_overrides`) to safe defaults so callers never have to null-check.
 *
 * Lives in `infra/seller/pricing` because it is a Supabase-shaped reader; pure
 * core code consumes it through the orchestrator, never directly.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';

export interface SellerListingRow {
  id: string;
  variant_id: string;
  provider_account_id: string;
  external_listing_id: string | null;
  external_product_id: string | null;
  listing_type: string;
  status: string;
  currency: string;
  price_cents: number;
  min_price_cents: number;
  min_price_mode: string;
  min_price_override_cents: number;
  cost_basis_cents: number;
  declared_stock: number;
  auto_sync_stock: boolean;
  auto_sync_price: boolean;
  provider_metadata: Record<string, unknown>;
  pricing_overrides: Record<string, unknown> | null;
  provider_code: string;
}

@injectable()
export class SellerListingFetcher {
  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async getAutoSyncPriceListings(): Promise<SellerListingRow[]> {
    const rows = await this.db.query<Record<string, unknown>>('seller_listings', {
      eq: [
        ['status', 'active'],
        ['auto_sync_price', true],
      ],
    });
    return this.enrich(rows);
  }

  async getActiveListings(): Promise<SellerListingRow[]> {
    const rows = await this.db.query<Record<string, unknown>>('seller_listings', {
      eq: [['status', 'active']],
    });
    return this.enrich(rows);
  }

  private async enrich(rows: Record<string, unknown>[]): Promise<SellerListingRow[]> {
    if (rows.length === 0) return [];

    const accountIds = [...new Set(rows.map((r) => r.provider_account_id as string))];
    const accountMap = new Map<string, string>();
    for (const accountId of accountIds) {
      const account = await this.db.queryOne<{ provider_code: string }>('provider_accounts', {
        filter: { id: accountId },
      });
      if (account) accountMap.set(accountId, account.provider_code);
    }

    const enriched: SellerListingRow[] = [];
    for (const row of rows) {
      const providerCode = accountMap.get(row.provider_account_id as string);
      if (!providerCode) continue;
      enriched.push({
        ...(row as unknown as Omit<SellerListingRow, 'provider_code'>),
        provider_code: providerCode,
        provider_metadata: (row.provider_metadata as Record<string, unknown>) ?? {},
        pricing_overrides: (row.pricing_overrides as Record<string, unknown>) ?? null,
      } as SellerListingRow);
    }
    return enriched;
  }
}
