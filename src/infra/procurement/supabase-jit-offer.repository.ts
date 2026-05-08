/**
 * Supabase adapter for `IJitOfferRepository`.
 *
 * Loads `provider_variant_offers` joined to `provider_accounts` filtered to
 * **buyer-capable** accounts (`is_enabled = true AND supports_seller = false`).
 * Sellers like Eneba / Kinguin / G2A / Gamivo / Digiseller are excluded.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type {
  IJitOfferRepository,
  JitCandidateOffer,
} from '../../core/use-cases/procurement/route-and-purchase-jit-offers.use-case.js';
import { coerceProcurementAvailableQuantity } from '../seller/load-procurement-offer-supply.js';

@injectable()
export class SupabaseJitOfferRepository implements IJitOfferRepository {
  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async findBuyerCapableOffersForVariant(variantId: string): Promise<JitCandidateOffer[]> {
    const rows = await this.db.query<{
      id: string | null;
      variant_id: string | null;
      provider_account_id: string | null;
      external_offer_id: string | null;
      currency: string | null;
      prioritize_quote_sync: boolean | null;
      last_price_cents: number | null;
      available_quantity: number | string | null;
    }>('provider_variant_offers', {
      select:
        'id, variant_id, provider_account_id, external_offer_id, currency, prioritize_quote_sync, last_price_cents, available_quantity',
      eq: [
        ['variant_id', variantId],
        ['is_active', true],
      ],
    });

    if (rows.length === 0) return [];

    const accountIds = [
      ...new Set(
        rows
          .map((r) => r.provider_account_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    ];
    if (accountIds.length === 0) return [];

    const accounts = await this.db.query<{
      id: string;
      provider_code: string | null;
      is_enabled: boolean | null;
      supports_seller: boolean | null;
    }>('provider_accounts', {
      select: 'id, provider_code, is_enabled, supports_seller',
      in: [['id', accountIds]],
    });

    const buyerAccounts = new Map<string, string>();
    for (const a of accounts) {
      if (a.is_enabled !== true) continue;
      if (a.supports_seller === true) continue;
      const code = (a.provider_code ?? '').trim().toLowerCase();
      if (!code) continue;
      buyerAccounts.set(a.id, code);
    }

    const out: JitCandidateOffer[] = [];
    for (const r of rows) {
      const acc = r.provider_account_id;
      if (typeof acc !== 'string') continue;
      const code = buyerAccounts.get(acc);
      if (!code) continue;
      const offerId = typeof r.external_offer_id === 'string' ? r.external_offer_id.trim() : '';
      if (!offerId) continue;
      if (typeof r.id !== 'string' || !r.id) continue;
      const currency = typeof r.currency === 'string' ? r.currency.trim().toUpperCase() : '';
      if (!/^[A-Z]{3}$/.test(currency)) continue;

      const last_price_cents =
        typeof r.last_price_cents === 'number' && Number.isFinite(r.last_price_cents)
          ? r.last_price_cents
          : null;
      const available_quantity = coerceProcurementAvailableQuantity(r.available_quantity);

      out.push({
        id: r.id,
        provider_code: code,
        provider_account_id: acc,
        external_offer_id: offerId,
        currency,
        last_price_cents,
        available_quantity,
        prioritize_quote_sync: r.prioritize_quote_sync === true,
      });
    }

    return out;
  }
}
