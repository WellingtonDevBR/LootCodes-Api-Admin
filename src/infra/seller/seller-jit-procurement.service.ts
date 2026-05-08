/**
 * Native JIT procurement for marketplace reserves.
 *
 * Thin wrapper around `RouteAndPurchaseJitOffersUseCase` — the routing,
 * USD-FX normalization, margin gate, wallet preflight, and cheapest-first
 * iteration all live in the use case. This service adapts seller-side
 * `ClaimKeysParams` into the use-case input, FX-converts the sale price
 * to USD (listing currencies like EUR must not be passed raw as USD cents),
 * and surfaces the optional env-driven attribution actor for
 * `provider_purchase_attempts`.
 */
import { injectable, inject } from 'tsyringe';
import { getEnv } from '../../config/env.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import type { ClaimKeysParams } from '../../core/ports/seller-key-operations.port.js';
import type { IProcurementFxConverter } from '../../core/ports/procurement-fx-converter.port.js';
import { RouteAndPurchaseJitOffersUseCase } from '../../core/use-cases/procurement/route-and-purchase-jit-offers.use-case.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('seller-jit-procurement');

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

@injectable()
export class SellerJitProcurementService {
  constructor(
    @inject(UC_TOKENS.RouteAndPurchaseJitOffers)
    private readonly route: RouteAndPurchaseJitOffersUseCase,
    @inject(TOKENS.ProcurementFxConverter)
    private readonly fx: IProcurementFxConverter,
  ) {}

  /**
   * Attempts to procure keys for a marketplace reservation by routing to the
   * cheapest USD-normalized buyer-capable provider whose wallet has credit.
   *
   * @returns true when at least one key was ingested — caller should retry
   *          `claim_and_reserve_atomic`.
   */
  async tryJitPurchaseForReservation(params: ClaimKeysParams): Promise<boolean> {
    const envActor = getEnv().JIT_PROCUREMENT_ACTOR_USER_ID;
    const adminUserId =
      typeof envActor === 'string' && envActor.trim().length > 0 && isUuid(envActor.trim())
        ? envActor.trim()
        : null;

    // The margin gate inside RouteAndPurchaseJitOffersUseCase compares buy-side
    // costs (always USD) against salePriceUsdCents. If the listing currency is
    // EUR (or any non-USD), passing raw cents without conversion produces a false
    // ceiling (e.g. 1518 EUR-cents interpreted as $15.18 blocks a $16.14 buy that
    // would actually have been profitable at the real EUR/USD rate of ~1.08).
    let salePriceUsdCents: number | undefined;
    if (typeof params.salePriceCents === 'number') {
      const currency = params.salePriceCurrency ?? 'USD';
      if (currency === 'USD') {
        salePriceUsdCents = params.salePriceCents;
      } else {
        const converted = await this.fx.toUsdCents(params.salePriceCents, currency);
        if (converted != null && Number.isFinite(converted) && converted > 0) {
          salePriceUsdCents = converted;
          logger.debug('Sale price FX-converted for JIT margin gate', {
            variantId: params.variantId,
            original: params.salePriceCents,
            currency,
            usdCents: converted,
          });
        } else {
          // FX unavailable — omit the ceiling so the JIT still runs without a
          // margin gate rather than silently blocking all providers.
          logger.warn('Sale price FX conversion unavailable; running JIT without margin ceiling', {
            variantId: params.variantId,
            currency,
          });
        }
      }
    }

    const result = await this.route.execute({
      variantId: params.variantId,
      quantity: params.quantity,
      externalReservationId: params.externalReservationId,
      adminUserId,
      ...(salePriceUsdCents != null ? { salePriceUsdCents } : {}),
      ...(typeof params.minMarginCents === 'number'
        ? { minMarginUsdCents: params.minMarginCents }
        : {}),
      ...(typeof params.feesCents === 'number' ? { feesUsdCents: params.feesCents } : {}),
    });

    if (result.purchased) {
      logger.info('JIT procurement ingested keys', {
        variantId: params.variantId,
        keysIngested: result.ingestedKeyCount,
        winningProviderCode: result.winningProviderCode,
      });
      return true;
    }

    logger.warn('JIT procurement did not yield ingested keys', {
      variantId: params.variantId,
      attempted: result.attemptedProviders.length,
      attemptedProviders: result.attemptedProviders,
    });
    return false;
  }
}
