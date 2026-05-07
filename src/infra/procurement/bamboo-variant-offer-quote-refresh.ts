/**
 * Live Bamboo catalog quote refresh for linked `provider_variant_offers` rows.
 * Updates DB + mutates in-memory snapshot rows used by `/procurement/quote`.
 */
import type { IDatabase } from '../../core/ports/database.port.js';
import { createLogger } from '../../shared/logger.js';
import { resolveProviderSecrets } from '../marketplace/resolve-provider-secrets.js';
import { createBambooManualBuyer } from './bamboo-manual-buyer.js';
import { normalizeBambooWalletCurrency } from './bamboo-resolve-checkout-account.js';

const logger = createLogger('bamboo-offer-quote-refresh');

export interface VariantOfferSnapshotRow {
  readonly id: string;
  readonly provider_account_id: string;
  readonly external_offer_id: string | null;
  /** Quote wallet / listing currency; updated after a successful Bamboo catalog quote. */
  currency: string | null;
  last_price_cents: number | null;
  available_quantity: number | null;
}

export interface ProviderAccountRowLite {
  readonly id: string;
  readonly provider_code: string | null;
  readonly api_profile: Record<string, unknown> | null;
}

function asProfile(raw: unknown): Record<string, unknown> {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * Calls Bamboo catalog for each linked Bamboo offer and persists `last_price_cents`,
 * `available_quantity`, `currency`, and `last_checked_at`. Mutates `offers` in place on success.
 */
export async function refreshBambooOfferSnapshotsForVariant(
  db: IDatabase,
  offers: VariantOfferSnapshotRow[],
  accountsById: ReadonlyMap<string, ProviderAccountRowLite>,
  options?: { readonly providerCodeFilter?: string | undefined },
): Promise<void> {
  const filter = options?.providerCodeFilter?.trim().toLowerCase();
  if (filter && filter !== 'bamboo') {
    return;
  }

  for (const offer of offers) {
    const extId = offer.external_offer_id?.trim();
    if (!extId) continue;

    const acc = accountsById.get(offer.provider_account_id);
    const code = (acc?.provider_code ?? '').trim().toLowerCase();
    if (code !== 'bamboo') continue;

    try {
      const secrets = await resolveProviderSecrets(db, offer.provider_account_id);
      const buyer = createBambooManualBuyer({
        secrets,
        profile: asProfile(acc?.api_profile),
      });
      if (!buyer) {
        continue;
      }

      const walletCur = normalizeBambooWalletCurrency(offer.currency ?? 'USD');
      const quote = await buyer.quote(extId, walletCur);
      const now = new Date().toISOString();

      await db.update(
        'provider_variant_offers',
        { id: offer.id },
        {
          last_price_cents: quote.price_cents,
          available_quantity: quote.available_quantity,
          currency: quote.currency,
          last_checked_at: now,
          updated_at: now,
        },
      );

      offer.last_price_cents = quote.price_cents;
      offer.available_quantity = quote.available_quantity;
      offer.currency = quote.currency;
    } catch (err) {
      logger.warn('Bamboo live quote refresh failed for linked offer', {
        offerRowId: offer.id,
        external_offer_id: extId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
