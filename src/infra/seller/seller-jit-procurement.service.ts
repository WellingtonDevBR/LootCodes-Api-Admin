/**
 * Native JIT procurement for marketplace reserves: when `claim_and_reserve_atomic` fails,
 * buy from linked `provider_variant_offers` (Bamboo, cheapest viable first) in-process.
 */
import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import { getEnv } from '../../config/env.js';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { ClaimKeysParams } from '../../core/ports/seller-key-operations.port.js';
import {
  compareProcurementOffersForDeclaredStockReconcile,
  type ProcurementOfferSortRow,
} from '../../core/shared/procurement-declared-stock.js';
import { BuyerManualPurchaseService } from '../procurement/buyer-manual-purchase.service.js';
import { coerceProcurementAvailableQuantity } from './load-procurement-offer-supply.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('seller-jit-procurement');

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

interface JitOfferRow extends ProcurementOfferSortRow {
  readonly id: string;
  readonly provider_account_id: string;
  readonly external_offer_id: string;
}

function maxUnitCostForMargin(params: {
  readonly salePriceCents?: number;
  readonly minMarginCents?: number;
  readonly feesCents?: number;
}): number | null {
  const sale = params.salePriceCents;
  if (typeof sale !== 'number' || !Number.isFinite(sale)) return null;
  const margin = typeof params.minMarginCents === 'number' && Number.isFinite(params.minMarginCents)
    ? params.minMarginCents
    : 0;
  const fees = typeof params.feesCents === 'number' && Number.isFinite(params.feesCents)
    ? params.feesCents
    : 0;
  return sale - margin - fees;
}

@injectable()
export class SellerJitProcurementService {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.BuyerManualPurchaseService) private readonly buyerManual: BuyerManualPurchaseService,
  ) {}

  /**
   * Attempt native Bamboo buys from linked procurement offers (cheapest / best-stock signal first).
   * @returns true when at least one key was ingested — caller should retry `claim_and_reserve_atomic`.
   */
  async tryJitPurchaseForReservation(params: ClaimKeysParams): Promise<boolean> {
    const envActor = getEnv().JIT_PROCUREMENT_ACTOR_USER_ID;
    const optionalAttribution =
      typeof envActor === 'string' && envActor.trim().length > 0 && isUuid(envActor.trim())
        ? envActor.trim()
        : undefined;

    const offers = await this.loadSortedBambooOffers(params);
    if (offers.length === 0) {
      logger.info('JIT procurement — no viable Bamboo offers for variant', { variantId: params.variantId });
      return false;
    }

    const maxUnitCost = maxUnitCostForMargin({
      salePriceCents: params.salePriceCents,
      minMarginCents: params.minMarginCents,
      feesCents: params.feesCents,
    });

    if (maxUnitCost != null && Number.isFinite(maxUnitCost) && maxUnitCost <= 0) {
      logger.warn('JIT procurement skipped — sale price minus margin/fees is non-positive', {
        variantId: params.variantId,
        maxUnitCost,
      });
      return false;
    }

    for (const offer of offers) {
      if (maxUnitCost != null && Number.isFinite(maxUnitCost)) {
        if (
          typeof offer.last_price_cents === 'number'
          && Number.isFinite(offer.last_price_cents)
          && offer.last_price_cents > maxUnitCost
        ) {
          continue;
        }
      }

      const idempotencyKey = `jit-${params.variantId}-${params.externalReservationId}-${offer.id}-${randomUUID()}`;

      const result = await this.buyerManual.executeJitBambooPurchase({
        variant_id: params.variantId,
        provider_account_id: offer.provider_account_id,
        offer_id: offer.external_offer_id,
        quantity: params.quantity,
        idempotency_key: idempotencyKey,
        ...(optionalAttribution ? { admin_user_id: optionalAttribution } : {}),
      });

      const ingested = result.keys_ingested ?? 0;
      if (result.success && ingested > 0) {
        logger.info('JIT procurement ingested keys', {
          variantId: params.variantId,
          keysIngested: ingested,
          offerRowId: offer.id,
        });
        return true;
      }

      logger.warn('JIT procurement attempt did not yield ingested keys', {
        variantId: params.variantId,
        offerRowId: offer.id,
        error: result.error,
      });
    }

    return false;
  }

  private async loadSortedBambooOffers(params: ClaimKeysParams): Promise<JitOfferRow[]> {
    const rows = await this.db.query<Record<string, unknown>>('provider_variant_offers', {
      select:
        'id, variant_id, provider_account_id, external_offer_id, prioritize_quote_sync, last_price_cents, available_quantity',
      eq: [['variant_id', params.variantId], ['is_active', true]],
    });

    const accountIds = [...new Set(
      rows
        .map((r) => r.provider_account_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    )];

    if (accountIds.length === 0) return [];

    const accounts = await this.db.query<{ id: string; provider_code: string }>('provider_accounts', {
      select: 'id, provider_code',
      in: [['id', accountIds]],
    });

    const bambooAccountIds = new Set(
      accounts
        .filter((a) => (a.provider_code ?? '').trim().toLowerCase() === 'bamboo')
        .map((a) => a.id),
    );

    const q = params.quantity;
    const jitRows: JitOfferRow[] = [];

    for (const raw of rows) {
      const providerAccountId = raw.provider_account_id;
      if (typeof providerAccountId !== 'string' || !bambooAccountIds.has(providerAccountId)) continue;

      const ext = raw.external_offer_id;
      const offerIdStr = typeof ext === 'string' ? ext.trim() : ext != null ? String(ext).trim() : '';
      if (!offerIdStr) continue;

      const avail = coerceProcurementAvailableQuantity(raw.available_quantity);
      if (typeof avail === 'number' && Number.isFinite(avail) && avail < q) continue;

      const idVal = raw.id;
      if (typeof idVal !== 'string' || !idVal) continue;

      jitRows.push({
        id: idVal,
        provider_account_id: providerAccountId,
        external_offer_id: offerIdStr,
        prioritize_quote_sync: raw.prioritize_quote_sync === true,
        last_price_cents: typeof raw.last_price_cents === 'number' ? raw.last_price_cents : null,
        available_quantity: avail,
      });
    }

    return [...jitRows].sort((a, b) => compareProcurementOffersForDeclaredStockReconcile(a, b));
  }
}
