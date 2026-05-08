/**
 * Native JIT procurement for marketplace reserves.
 *
 * Thin wrapper around `RouteAndPurchaseJitOffersUseCase` — the routing,
 * USD-FX normalization, margin gate, wallet preflight, and cheapest-first
 * iteration all live in the use case. This service only adapts seller-side
 * `ClaimKeysParams` into the use-case input and surfaces the optional
 * env-driven attribution actor for `provider_purchase_attempts`.
 */
import { injectable, inject } from 'tsyringe';
import { getEnv } from '../../config/env.js';
import { UC_TOKENS } from '../../di/tokens.js';
import type { ClaimKeysParams } from '../../core/ports/seller-key-operations.port.js';
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

    const result = await this.route.execute({
      variantId: params.variantId,
      quantity: params.quantity,
      externalReservationId: params.externalReservationId,
      adminUserId,
      ...(typeof params.salePriceCents === 'number'
        ? { salePriceUsdCents: params.salePriceCents }
        : {}),
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
    });
    return false;
  }
}
