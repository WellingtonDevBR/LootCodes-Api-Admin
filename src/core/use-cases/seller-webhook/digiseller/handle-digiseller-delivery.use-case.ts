/**
 * Digiseller form delivery handler — Supplier API implementation.
 *
 * Mirrors the Edge Function `digiseller-webhook.ts` behaviour:
 *   1. Extract product ID and invoice ID from the polymorphic payload
 *   2. Look up listing by external_listing_id + provider_account_id
 *   3. Idempotency: if inv matches an existing reservation, replay keys
 *   4. Compute marketplace fees from webhook amount + seller_config commission
 *   5. Claim keys via claimKeysForReservation (local-first, JIT fallback)
 *   6. Decrypt + provision (synchronous — response body IS the key)
 *   7. Background: completeProvisionOrchestration, health, stock notify
 *
 * Response shape is mapped in the route layer (not here):
 *   Success: { id, inv, goods }
 *   Error:   { id, inv, error }
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { IListingHealthPort } from '../../../ports/seller-listing-health.port.js';
import type { IVariantUnavailabilityPort } from '../../../ports/variant-unavailability.port.js';
import type {
  DigisellerDeliveryDto,
  DigisellerDeliveryResult,
  DigisellerFormDeliveryPayload,
} from '../seller-webhook.types.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:digiseller');

const WEBMONEY_TO_ISO: Record<string, string> = {
  WMZ: 'USD', WME: 'EUR', WMR: 'RUB', WMU: 'UAH',
  WMB: 'BYN', WMK: 'KZT', WMT: 'USD',
};

function normalizeDigisellerCurrency(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = String(raw).trim().toUpperCase();
  if (!t) return null;
  if (WEBMONEY_TO_ISO[t]) return WEBMONEY_TO_ISO[t];
  if (/^[A-Z]{3}$/.test(t)) return t;
  return null;
}

function parseFiniteNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return v.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

interface ListingRow {
  id: string;
  variant_id: string;
  provider_account_id: string;
  status: string;
  price_cents: number;
  currency: string;
  min_jit_margin_cents: number | null;
  variant?: { product_id?: string } | null;
}

@injectable()
export class HandleDigisellerDeliveryUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.ListingHealth) private readonly health: IListingHealthPort,
    @inject(TOKENS.VariantUnavailability) private readonly unavailability: IVariantUnavailabilityPort,
  ) {}

  async execute(dto: DigisellerDeliveryDto): Promise<DigisellerDeliveryResult> {
    const { providerAccountId, payload } = dto;

    const productId = payload.id_goods ?? payload.product_id ?? payload.id;
    const invoiceId = payload.inv ?? payload.invoice_id;
    const quantity = payload.unit_cnt ?? 1;

    if (!productId) {
      logger.error('Digiseller form delivery — missing product ID', {
        payloadKeys: Object.keys(payload), invoiceId,
      });
      return { success: false, productId: undefined, invoiceId, errorMessage: 'Missing product ID' };
    }

    const externalListingId = String(productId);

    const isTestMode = !invoiceId || invoiceId === '0' || invoiceId === 0;
    const externalOrderId = isTestMode
      ? `digi-test-${externalListingId}-${Date.now()}`
      : String(invoiceId);

    if (isTestMode) {
      logger.info('Digiseller form delivery — TEST MODE', { productId, externalOrderId });
    }

    try {
      // --- Listing lookup ---
      const listing = await this.db.queryOne<ListingRow>(
        'seller_listings',
        {
          select: 'id, variant_id, provider_account_id, status, price_cents, currency, min_jit_margin_cents',
          eq: [['external_listing_id', externalListingId], ['provider_account_id', providerAccountId]],
          single: true,
        },
      );

      if (!listing) {
        logger.error('Digiseller form delivery — listing not found', { externalListingId, providerAccountId });
        this.health.updateHealthCounters(externalListingId, 'reservation', false).catch(() => {});
        return { success: false, productId, invoiceId, errorMessage: 'Product not found' };
      }

      // Resolve product_id for orchestration
      let resolvedProductId = '';
      try {
        const variant = await this.db.queryOne<{ product_id: string }>('product_variants', {
          select: 'product_id',
          eq: [['id', listing.variant_id]],
          single: true,
        });
        resolvedProductId = variant?.product_id ?? '';
      } catch {
        // non-critical
      }

      // --- Idempotency: check for existing reservation ---
      if (!isTestMode) {
        const existingReservation = await this.db.queryOne<{ id: string; status: string }>(
          'seller_stock_reservations',
          {
            select: 'id, status',
            eq: [['external_reservation_id', externalOrderId]],
            single: true,
          },
        ).catch(() => null);

        if (existingReservation) {
          try {
            const { decryptedKeys } = await this.keyOps.decryptDeliveredProvisionKeys(existingReservation.id);
            if (decryptedKeys.length > 0) {
              logger.info('Digiseller form delivery — idempotent replay', {
                invoiceId, externalListingId, keysReplayed: decryptedKeys.length,
              });
              return {
                success: true,
                keys: decryptedKeys.map((k) => k.plaintext),
                productId,
                invoiceId,
              };
            }
          } catch (replayErr) {
            logger.warn('Digiseller idempotent replay failed — will attempt new delivery', {
              invoiceId, reservationId: existingReservation.id,
              error: replayErr instanceof Error ? replayErr.message : String(replayErr),
            });
          }
        }
      }

      // --- Compute marketplace fees ---
      const sellerConfig = await this.resolveSellerConfig(providerAccountId);
      const commissionRate = sellerConfig.commission_rate_percent ?? 5;
      const listingCurrency = (listing.currency ?? 'EUR').toUpperCase();

      const { salePriceCents, feesCents } = this.computeFees(
        payload, listing.price_cents, listingCurrency, commissionRate,
      );

      const buyerEmail = typeof payload.email === 'string' ? payload.email.trim() || undefined : undefined;

      // --- Reserve (local-first, JIT fallback) ---
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      let outcome;
      try {
        outcome = await this.keyOps.claimKeysForReservation({
          variantId: listing.variant_id,
          listingId: listing.id,
          providerAccountId: listing.provider_account_id,
          quantity,
          externalReservationId: externalOrderId,
          externalOrderId,
          expiresAt,
          providerMetadata: {
            digiseller_invoice: invoiceId,
            digiseller_product_id: productId,
            unique_code: payload.unique_code,
            email: payload.email,
          },
          salePriceCents: salePriceCents || undefined,
          feesCents,
          minMarginCents: listing.min_jit_margin_cents ?? undefined,
        });
      } catch (claimErr) {
        logger.warn('Digiseller form delivery — out of stock', {
          externalListingId, invoiceId, variantId: listing.variant_id,
          error: claimErr instanceof Error ? claimErr.message : String(claimErr),
        });
        this.health.updateHealthCounters(externalListingId, 'reservation', false).catch(() => {});
        this.unavailability.propagateVariantUnavailable(listing.variant_id, 'jit_failed').catch(() => {});
        return { success: false, productId, invoiceId, errorMessage: 'Out of stock' };
      }

      // --- Decrypt + provision (synchronous) ---
      let provision;
      try {
        provision = await this.keyOps.provisionFromPendingKeys(outcome.reservationId);
      } catch (err) {
        logger.error('Digiseller form delivery — decrypt failed', err instanceof Error ? err : new Error(String(err)), {
          reservationId: outcome.reservationId,
        });
        this.health.updateHealthCounters(externalListingId, 'provision', false).catch(() => {});
        return { success: false, productId, invoiceId, errorMessage: 'Delivery failed' };
      }

      const keys = provision.decryptedKeys.map((k) => k.plaintext);

      // --- Background: post-provision orchestration + health + reconciliation ---
      setImmediate(() => {
        this.runBackgroundOrchestration({
          reservationId: outcome.reservationId,
          listingId: listing.id,
          variantId: listing.variant_id,
          productId: resolvedProductId,
          externalOrderId,
          externalListingId,
          keyIds: outcome.keyIds,
          keysProvisionedCount: provision.decryptedKeys.length,
          priceCents: salePriceCents > 0 ? salePriceCents : listing.price_cents,
          currency: listingCurrency,
          feeCents: feesCents > 0 ? feesCents : undefined,
          buyerEmail,
          isTestMode,
          invoiceId: externalOrderId,
          providerAccountId,
        }).catch((err) => {
          logger.warn('Digiseller background orchestration failed', {
            reservationId: outcome.reservationId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });

      logger.info('Digiseller form delivery — key delivered', {
        invoiceId, externalListingId, keysDelivered: keys.length, viaJit: outcome.viaJit,
      });

      return { success: true, keys, productId, invoiceId };
    } catch (err) {
      logger.error('Unexpected error in Digiseller delivery', err as Error, { externalOrderId, productId });
      return { success: false, productId, invoiceId, errorMessage: 'Internal error' };
    }
  }

  // ─── Fee computation ────────────────────────────────────────────────

  private computeFees(
    payload: DigisellerFormDeliveryPayload,
    listingPriceCents: number,
    listingCurrency: string,
    commissionRate: number,
  ): { salePriceCents: number; feesCents: number } {
    const rawCurr =
      (typeof payload.currency === 'string' && payload.currency.trim() !== '' ? payload.currency.trim() : '') ||
      (typeof payload.type_curr === 'string' && payload.type_curr.trim() !== '' ? payload.type_curr.trim() : '');
    const payloadIso = normalizeDigisellerCurrency(rawCurr);

    const payloadAmountMajor = parseFiniteNumber(payload.amount);
    const payloadProfitMajor = parseFiniteNumber(payload.profit);

    const strictAmountCents =
      payloadIso === listingCurrency && payloadAmountMajor != null && payloadAmountMajor > 0
        ? Math.round(payloadAmountMajor * 100)
        : null;
    const strictProfitCents =
      payloadIso === listingCurrency && payloadProfitMajor != null
        ? Math.round(payloadProfitMajor * 100)
        : null;

    const salePriceCents =
      strictAmountCents ??
      (typeof listingPriceCents === 'number' ? listingPriceCents : 0);

    const feesCents =
      strictAmountCents != null && strictProfitCents != null && strictAmountCents > 0
        ? Math.max(0, strictAmountCents - strictProfitCents)
        : (salePriceCents > 0 ? Math.round(salePriceCents * commissionRate / 100) : 0);

    return { salePriceCents, feesCents };
  }

  // ─── Background orchestration ───────────────────────────────────────

  private async runBackgroundOrchestration(params: {
    reservationId: string;
    listingId: string;
    variantId: string;
    productId: string;
    externalOrderId: string;
    externalListingId: string;
    keyIds: string[];
    keysProvisionedCount: number;
    priceCents: number;
    currency: string;
    feeCents?: number;
    buyerEmail?: string;
    isTestMode: boolean;
    invoiceId: string;
    providerAccountId: string;
  }): Promise<void> {
    try {
      await this.keyOps.completeProvisionOrchestration({
        reservationId: params.reservationId,
        listingId: params.listingId,
        variantId: params.variantId,
        productId: params.productId,
        providerCode: 'digiseller',
        externalOrderId: params.externalOrderId,
        keyIds: params.keyIds,
        keysProvisionedCount: params.keysProvisionedCount,
        priceCents: params.priceCents,
        currency: params.currency,
        feeCents: params.feeCents,
        buyerEmail: params.buyerEmail,
      });
    } catch (err) {
      logger.warn('Digiseller post-provision orchestration failed (key already delivered)', {
        reservationId: params.reservationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await this.health.updateHealthCounters(params.externalListingId, 'reservation', true).catch(() => {});
    await this.health.updateHealthCounters(params.externalListingId, 'provision', true).catch(() => {});
  }

  // ─── Config resolution ──────────────────────────────────────────────

  private async resolveSellerConfig(providerAccountId: string): Promise<{ commission_rate_percent: number }> {
    try {
      const account = await this.db.queryOne<{ seller_config: Record<string, unknown> }>(
        'provider_accounts',
        {
          select: 'seller_config',
          eq: [['id', providerAccountId]],
          single: true,
        },
      );
      const cfg = account?.seller_config ?? {};
      return {
        commission_rate_percent: typeof cfg.commission_rate_percent === 'number'
          ? cfg.commission_rate_percent : 5,
      };
    } catch {
      return { commission_rate_percent: 5 };
    }
  }
}
