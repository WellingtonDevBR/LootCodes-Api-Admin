/**
 * Native admin manual procurement orchestration (Bamboo first).
 * Mirrors Edge `provider-procurement/handlers/manual-purchase.ts` without Edge invoke.
 */
import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type {
  JitBambooPurchaseDto,
  ManualProviderPurchaseDto,
  ManualProviderPurchaseResult,
  ManualPurchaseFailedIngestion,
} from '../../core/use-cases/procurement/procurement.types.js';
import { createLogger } from '../../shared/logger.js';
import { InternalError } from '../../core/errors/domain-errors.js';
import {
  getDailyProcurementSpendCents,
  getProviderProcurementConfig,
  getVariantSalesBlockStatus,
} from './procurement-guardrails.js';
import { resolveProviderSecrets } from '../marketplace/resolve-provider-secrets.js';
import { createBambooManualBuyer, type BambooManualBuyer, type BambooOfferQuote } from './bamboo-manual-buyer.js';
import { ingestProviderPurchasedKey, KeyIngestionError } from './ingest-provider-key.js';

const logger = createLogger('buyer-manual-purchase');

const MAX_QUANTITY = 50;

const RECOVERABLE_ERROR_CODES = new Set([
  'NO_KEYS_RETURNED',
  'ORDER_TIMEOUT',
  'RECOVERY_TIMEOUT',
]);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function asApiProfile(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/** Bamboo manual checkout: catalog TargetCurrency + wallet selection (ISO 4217). */
function resolveCheckoutWalletCurrency(
  walletCurrencyHint: string | undefined,
  apiProfile: Record<string, unknown>,
): string | null {
  const rawDto =
    typeof walletCurrencyHint === 'string' && walletCurrencyHint.trim().length > 0
      ? walletCurrencyHint.trim()
      : '';
  const rawProfile =
    typeof apiProfile.checkout_wallet_currency === 'string' &&
    apiProfile.checkout_wallet_currency.trim().length > 0
      ? apiProfile.checkout_wallet_currency.trim()
      : '';
  const chosen = rawDto || rawProfile || 'USD';
  if (!/^[A-Za-z]{3}$/.test(chosen)) return null;
  return chosen.toUpperCase();
}

@injectable()
export class BuyerManualPurchaseService {
  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async execute(dto: ManualProviderPurchaseDto): Promise<ManualProviderPurchaseResult> {
    const requestId = randomUUID();

    if (!dto.variant_id?.trim() || !dto.provider_code?.trim() || !dto.offer_id?.trim()) {
      return { success: false, error: 'variant_id, provider_code, and offer_id are required' };
    }

    const quantity = Number(dto.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return { success: false, error: `quantity must be between 1 and ${MAX_QUANTITY}` };
    }

    if (!isUuid(dto.admin_id)) {
      return {
        success: false,
        error:
          'A valid authenticated admin user id is required for manual purchases (manual_admin_user_id FK).',
      };
    }

    const variantId = dto.variant_id.trim();
    const providerCode = dto.provider_code.trim().toLowerCase();
    const offerId = dto.offer_id.trim();
    const adminUserId = dto.admin_id.trim();

    const guardrailBlock = await this.checkSpendGuardrails(requestId, variantId);
    if (guardrailBlock) return guardrailBlock;

    if (providerCode !== 'bamboo') {
      return { success: false, error: `Provider ${dto.provider_code} does not support native manual purchasing yet` };
    }

    const providerAccountId = await this.getEnabledProviderAccountId(providerCode);
    if (!providerAccountId) {
      return { success: false, error: `Provider ${dto.provider_code} is not enabled or not found` };
    }

    const accountRow = await this.db.queryOne<{ api_profile: unknown }>('provider_accounts', {
      select: 'api_profile',
      filter: { id: providerAccountId },
    });
    const apiProfile = asApiProfile(accountRow?.api_profile);

    const secrets = await resolveProviderSecrets(this.db, providerAccountId);
    const bambooBuyer = createBambooManualBuyer({ secrets, profile: apiProfile });
    if (!bambooBuyer) {
      return {
        success: false,
        error: 'Bamboo credentials or api_profile (account_id, base URLs) are not configured for this provider account',
      };
    }

    const walletCurrency = resolveCheckoutWalletCurrency(dto.wallet_currency, apiProfile);
    if (!walletCurrency) {
      return {
        success: false,
        error:
          'wallet_currency must be a 3-letter ISO code (e.g. USD, EUR), or set api_profile.checkout_wallet_currency',
      };
    }

    const idempotencyKey = `manual-${variantId}-${requestId}`;

    return this.runBambooPurchaseAfterSetup({
      requestId,
      variantId,
      providerCode,
      offerId,
      quantity,
      adminUserId,
      idempotencyKey,
      providerAccountId,
      bambooBuyer,
      walletCurrency,
      attemptSource: 'manual',
    });
  }

  /**
   * JIT marketplace reserve: purchase from the Bamboo account attached to the linked offer row
   * (not necessarily the first enabled Bamboo account).
   */
  async executeJitBambooPurchase(dto: JitBambooPurchaseDto): Promise<ManualProviderPurchaseResult> {
    const requestId = randomUUID();

    if (!dto.variant_id?.trim() || !dto.offer_id?.trim() || !dto.provider_account_id?.trim()) {
      return { success: false, error: 'variant_id, offer_id, and provider_account_id are required' };
    }

    const quantity = Number(dto.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return { success: false, error: `quantity must be between 1 and ${MAX_QUANTITY}` };
    }

    const rawActor = dto.admin_user_id;
    let adminUserId: string | null = null;
    if (rawActor != null && String(rawActor).trim() !== '') {
      const t = String(rawActor).trim();
      if (!isUuid(t)) {
        return {
          success: false,
          error: 'admin_user_id must be a valid UUID when provided (optional attribution for JIT).',
        };
      }
      adminUserId = t;
    }

    if (!dto.idempotency_key?.trim()) {
      return { success: false, error: 'idempotency_key is required for JIT purchases' };
    }

    const variantId = dto.variant_id.trim();
    const providerAccountId = dto.provider_account_id.trim();
    const offerId = dto.offer_id.trim();
    const idempotencyKey = dto.idempotency_key.trim();

    const guardrailBlock = await this.checkSpendGuardrails(requestId, variantId);
    if (guardrailBlock) return guardrailBlock;

    const accountRow = await this.db.queryOne<{
      api_profile: unknown;
      provider_code: string;
      is_enabled: boolean;
    }>('provider_accounts', {
      select: 'api_profile, provider_code, is_enabled',
      filter: { id: providerAccountId },
    });

    if (!accountRow?.is_enabled) {
      return { success: false, error: 'Provider account is disabled or not found' };
    }

    const providerCode = accountRow.provider_code.trim().toLowerCase();
    if (providerCode !== 'bamboo') {
      return { success: false, error: 'JIT native purchase only supports bamboo for this provider account' };
    }

    const apiProfile = asApiProfile(accountRow.api_profile);

    const secrets = await resolveProviderSecrets(this.db, providerAccountId);
    const bambooBuyer = createBambooManualBuyer({ secrets, profile: apiProfile });
    if (!bambooBuyer) {
      return {
        success: false,
        error: 'Bamboo credentials or api_profile (account_id, base URLs) are not configured for this provider account',
      };
    }

    const walletCurrency = resolveCheckoutWalletCurrency(dto.wallet_currency, apiProfile);
    if (!walletCurrency) {
      return {
        success: false,
        error:
          'wallet_currency must be a 3-letter ISO code (e.g. USD, EUR), or set api_profile.checkout_wallet_currency',
      };
    }

    return this.runBambooPurchaseAfterSetup({
      requestId,
      variantId,
      providerCode,
      offerId,
      quantity,
      adminUserId,
      idempotencyKey,
      providerAccountId,
      bambooBuyer,
      walletCurrency,
      attemptSource: 'seller_jit',
    });
  }

  private async runBambooPurchaseAfterSetup(params: {
    requestId: string;
    variantId: string;
    providerCode: string;
    offerId: string;
    quantity: number;
    adminUserId: string | null;
    idempotencyKey: string;
    providerAccountId: string;
    bambooBuyer: BambooManualBuyer;
    walletCurrency: string;
    attemptSource: 'manual' | 'seller_jit';
  }): Promise<ManualProviderPurchaseResult> {
    const {
      requestId,
      variantId,
      providerCode,
      offerId,
      quantity,
      adminUserId,
      idempotencyKey,
      providerAccountId,
      bambooBuyer,
      walletCurrency,
      attemptSource,
    } = params;

    const preflight = await this.preflightQuote(
      bambooBuyer,
      offerId,
      quantity,
      requestId,
      providerCode,
      walletCurrency,
    );
    if (preflight.status === 'failed') {
      return { success: false, error: preflight.error };
    }
    if (preflight.status === 'insufficient_stock') {
      return {
        success: false,
        error: `Insufficient stock: ${preflight.quote.available_quantity} available, ${quantity} requested`,
      };
    }
    const prefetchedQuote = preflight.quote;

    let attemptId: string | null = null;
    try {
      const inserted = await this.db.insert<{ id: string }>('provider_purchase_attempts', {
        provider_account_id: providerAccountId,
        variant_id: variantId,
        attempt_no: 1,
        provider_request_id: idempotencyKey,
        status: 'pending',
        manual_admin_user_id: adminUserId,
      });
      attemptId = inserted.id;
    } catch (err) {
      const msg = err instanceof InternalError ? err.message : err instanceof Error ? err.message : String(err);
      if (msg.includes('23505') || msg.toLowerCase().includes('duplicate')) {
        return {
          success: false,
          error:
            'Duplicate purchase idempotency key — wait for the in-flight attempt to finish or generate a new key.',
        };
      }
      logger.error('Failed to insert pending provider_purchase_attempts row', err as Error, {
        variantId,
        providerAccountId,
      });
      return {
        success: false,
        error:
          'Could not record purchase attempt (database error). Check provider_purchase_attempts constraints and retry.',
      };
    }

    try {
      const result = await bambooBuyer.purchase(offerId, quantity, idempotencyKey, {
        prefetchedQuote,
        walletCurrency,
      });

      if (
        !result.success
        && result.provider_order_ref
        && result.error_code != null
        && RECOVERABLE_ERROR_CODES.has(result.error_code)
      ) {
        await this.finalizeAttempt(attemptId, {
          status: 'timeout',
          provider_order_ref: result.provider_order_ref,
          error_code: result.error_code,
          error_message: result.error_message,
        });
        return {
          success: false,
          recoverable: true,
          provider_order_ref: result.provider_order_ref,
          purchase_id: result.provider_order_ref,
          error:
            `Order ${result.provider_order_ref} placed at ${providerCode} — keys not yet delivered. ` +
            `They will be automatically recovered when ${providerCode} completes the order, ` +
            `or you can click Recover to retry now.`,
        };
      }

      if (!result.success || !result.keys || result.keys.length === 0) {
        await this.finalizeAttempt(attemptId, {
          status: 'failed',
          provider_order_ref: result.provider_order_ref,
          error_code: result.error_code,
          error_message: result.error_message,
        });
        return {
          success: false,
          error: result.error_message ?? 'Purchase returned no keys',
          provider_order_ref: result.provider_order_ref,
          purchase_id: result.provider_order_ref,
        };
      }

      const providerRef = result.provider_order_ref ?? idempotencyKey;
      const ingestedKeyIds: string[] = [];
      const failedIngestions: ManualPurchaseFailedIngestion[] = [];

      for (let i = 0; i < result.keys.length; i++) {
        const key = result.keys[i]!;
        try {
          const keyId = await ingestProviderPurchasedKey(
            this.db,
            {
              variant_id: variantId,
              plaintext_key: key,
              purchase_cost_cents: result.cost_cents ?? null,
              purchase_currency: result.currency ?? 'EUR',
              supplier_reference: `${providerCode}:${providerRef}`,
              created_by: adminUserId ?? undefined,
            },
            requestId,
          );
          ingestedKeyIds.push(keyId);
        } catch (ingestErr) {
          const stage = ingestErr instanceof KeyIngestionError ? ingestErr.stage : 'unknown';
          const message = ingestErr instanceof Error ? ingestErr.message : String(ingestErr);
          logger.error('Manual purchase key ingestion failed', ingestErr as Error, {
            requestId,
            providerCode,
            keyIndex: i,
            stage,
          });
          failedIngestions.push({ index: i, stage, error: message, plaintext_key: key });
        }
      }

      await this.finalizeAttempt(attemptId, {
        status: 'success',
        provider_order_ref: providerRef,
        response_snapshot: {
          keys_received: result.keys.length,
          keys_ingested: ingestedKeyIds.length,
          cost_cents: result.cost_cents,
          currency: result.currency,
          ...(attemptSource === 'seller_jit'
            ? { procurement_trigger: 'seller_reserve_jit' as const }
            : {}),
        },
      });

      const allFailed = ingestedKeyIds.length === 0 && failedIngestions.length > 0;

      logger.info('Bamboo purchase completed', {
        requestId,
        variantId,
        providerCode,
        keysReceived: result.keys.length,
        keysIngested: ingestedKeyIds.length,
        keysFailed: failedIngestions.length,
        costCents: result.cost_cents,
        currency: result.currency,
      });

      if (allFailed) {
        return {
          success: false,
          error:
            `Provider charged us but ${failedIngestions.length} key(s) could not be saved — ` +
            `copy the plaintext from \`failed_ingestions\` immediately and add them via Add Stock. ` +
            `Underlying: ${failedIngestions[0]!.error}`,
          purchase_id: providerRef,
          provider_order_ref: providerRef,
          keys_received: result.keys.length,
          keys_ingested: 0,
          failed_ingestions: failedIngestions,
        };
      }

      return {
        success: true,
        purchase_id: providerRef,
        provider_order_ref: providerRef,
        key_ids: ingestedKeyIds,
        partial_failure: failedIngestions.length > 0,
        keys_received: result.keys.length,
        keys_ingested: ingestedKeyIds.length,
        ...(failedIngestions.length > 0 ? { failed_ingestions: failedIngestions } : {}),
      };
    } catch (err) {
      await this.finalizeAttempt(attemptId, {
        status: 'failed',
        error_code: 'EXCEPTION',
        error_message: err instanceof Error ? err.message : String(err),
      });
      logger.error('Bamboo purchase threw', err as Error, { requestId, providerCode });
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Purchase request failed',
      };
    }
  }

  private async checkSpendGuardrails(
    requestId: string,
    variantId: string,
  ): Promise<ManualProviderPurchaseResult | null> {
    const blockStatus = await getVariantSalesBlockStatus(this.db, variantId);
    if (blockStatus.blocked) {
      logger.warn('Manual purchase blocked — variant sales blocked', {
        requestId,
        variantId,
        blockedAt: blockStatus.blockedAt,
        reason: blockStatus.reason,
      });
      return {
        success: false,
        error: `Variant sales are disabled${blockStatus.reason ? `: ${blockStatus.reason}` : ''}. Unblock the variant first to buy more keys.`,
      };
    }

    const config = await getProviderProcurementConfig(this.db);
    if (!config.auto_buy_enabled) {
      logger.info('Manual purchase blocked — auto_buy disabled', { requestId, variantId });
      return { success: false, error: 'Auto-buy is disabled in procurement config' };
    }

    if (config.daily_spend_limit_cents != null) {
      const todaySpend = await getDailyProcurementSpendCents(this.db);
      if (todaySpend >= config.daily_spend_limit_cents) {
        logger.warn('Manual purchase blocked — daily spend limit', {
          requestId,
          variantId,
          todaySpend,
          limit: config.daily_spend_limit_cents,
        });
        return {
          success: false,
          error: `Daily spend limit reached (${todaySpend}/${config.daily_spend_limit_cents} cents)`,
        };
      }
    }

    return null;
  }

  private async getEnabledProviderAccountId(providerCode: string): Promise<string | null> {
    const rows = await this.db.query<{ id: string }>('provider_accounts', {
      select: 'id',
      eq: [
        ['provider_code', providerCode],
        ['is_enabled', true],
      ],
      limit: 1,
    });
    return rows[0]?.id ?? null;
  }

  async listBambooLiveWallets(): Promise<{
    success: boolean;
    wallets?: ReadonlyArray<{ id: number; currency: string; balance: number }>;
    error?: string;
  }> {
    const providerAccountId = await this.getEnabledProviderAccountId('bamboo');
    if (!providerAccountId) {
      return { success: false, error: 'Bamboo provider is not enabled or not found' };
    }

    const accountRow = await this.db.queryOne<{ api_profile: unknown }>('provider_accounts', {
      select: 'api_profile',
      filter: { id: providerAccountId },
    });
    const apiProfile = asApiProfile(accountRow?.api_profile);

    const secrets = await resolveProviderSecrets(this.db, providerAccountId);
    const bambooBuyer = createBambooManualBuyer({ secrets, profile: apiProfile });
    if (!bambooBuyer) {
      return {
        success: false,
        error:
          'Bamboo credentials or api_profile (account_id, base URLs) are not configured for this provider account',
      };
    }

    try {
      const wallets = await bambooBuyer.fetchLiveWalletSummaries();
      return { success: true, wallets };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  private async preflightQuote(
    buyer: BambooManualBuyer,
    offerId: string,
    quantity: number,
    requestId: string,
    providerCode: string,
    walletCurrency: string,
  ): Promise<
    | { status: 'ok'; quote: BambooOfferQuote }
    | { status: 'insufficient_stock'; quote: BambooOfferQuote }
    | { status: 'failed'; error: string }
  > {
    try {
      const quote = await buyer.quote(offerId, walletCurrency);
      if (quote.available_quantity !== null && quote.available_quantity < quantity) {
        logger.warn('Manual purchase — insufficient stock', {
          requestId,
          providerCode,
          offerId,
          requested: quantity,
          available: quote.available_quantity,
        });
        return { status: 'insufficient_stock', quote };
      }
      return { status: 'ok', quote };
    } catch (err) {
      logger.warn('Manual purchase — pre-flight quote failed', {
        requestId,
        providerCode,
        offerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        status: 'failed',
        error: `Pre-flight quote failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async finalizeAttempt(
    attemptId: string | null,
    update: {
      status: 'success' | 'failed' | 'timeout';
      provider_order_ref?: string;
      error_code?: string;
      error_message?: string;
      response_snapshot?: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!attemptId) return;
    try {
      await this.db.update(
        'provider_purchase_attempts',
        { id: attemptId },
        {
          status: update.status,
          provider_order_ref: update.provider_order_ref,
          error_code: update.error_code,
          error_message: update.error_message,
          response_snapshot: update.response_snapshot,
          finished_at: new Date().toISOString(),
        },
      );
    } catch (err) {
      logger.error('Failed to finalize provider_purchase_attempts row', err as Error, {
        attemptId,
        status: update.status,
      });
    }
  }
}
