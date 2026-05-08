/**
 * Digiseller Supplier API — stock quantity check (url_for_quantity callback).
 *
 * Digiseller spec:
 *   Request:  POST { product_id, count, sign, options? }
 *   Response: { product_id, count }  (always HTTP 200)
 *
 * sign = SHA256(product_id + ":" + count + ":" + apiKey)
 *
 * Sign verification uses multiple candidate formats to match Digiseller's
 * actual signing behaviour (observed via diagnostic logging in Edge Function).
 *
 * Test-mode: Digiseller's "Query test" UI wraps the payload in a `forward`
 * envelope and signs with an ephemeral token — we skip sign verification.
 */
import { injectable, inject } from 'tsyringe';
import { createHash, timingSafeEqual } from 'node:crypto';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { DigisellerQuantityCheckDto, DigisellerQuantityCheckResult } from '../seller-webhook.types.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:digiseller:quantity');

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return timingSafeEqual(bufA, bufB);
}

@injectable()
export class HandleDigisellerQuantityCheckUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async execute(dto: DigisellerQuantityCheckDto): Promise<DigisellerQuantityCheckResult> {
    const { providerAccountId, productId, requestedCount, sign, isTestEnvelope, rawBody } = dto;

    if (!productId) {
      return { productId: '', count: 0, error: 'Missing product_id' };
    }

    // --- Sign verification (skip for test envelope) ---
    if (isTestEnvelope) {
      logger.info('Digiseller quantity check — test envelope detected, skipping signature verification', {
        productId, requestedCount,
      });
    } else if (sign && requestedCount > 0) {
      const valid = await this.verifySign(providerAccountId, productId, requestedCount, sign, rawBody);
      if (!valid) {
        logger.warn('Digiseller quantity check — sign mismatch, rejecting', { productId, requestedCount });
        return { productId, count: 0, error: 'Invalid signature' };
      }
    }

    // --- Listing lookup ---
    const listing = await this.db.queryOne<{
      variant_id: string;
      provider_account_id: string;
      price_cents: number;
      min_jit_margin_cents: number | null;
      status: string;
    }>('seller_listings', {
      select: 'variant_id, provider_account_id, price_cents, min_jit_margin_cents, status',
      eq: [['external_listing_id', productId], ['provider_account_id', providerAccountId]],
      single: true,
    }).catch((err: unknown) => {
      logger.warn('Digiseller quantity-check listing lookup failed', err as Error, {
        productId, providerAccountId,
      });
      return null;
    });

    if (!listing) {
      return { productId, count: 0, error: 'Product not found' };
    }

    if (listing.status === 'paused' || listing.status === 'removed' || listing.status === 'failed') {
      logger.info('Digiseller quantity check — listing inactive', { productId, status: listing.status });
      return { productId, count: 0 };
    }

    // --- Count available keys ---
    let localCount = 0;
    try {
      const result = await this.db.rpc<number>('count_marketplace_keys_for_provider', {
        p_variant_id: listing.variant_id,
        p_provider_account_id: listing.provider_account_id,
      });
      localCount = result ?? 0;
    } catch (err) {
      logger.warn('Digiseller quantity check — key count failed', {
        productId, error: err instanceof Error ? err.message : String(err),
      });
    }

    let totalQuantity = localCount;
    if (requestedCount > 0) {
      totalQuantity = Math.min(totalQuantity, requestedCount);
    }

    logger.info('Digiseller quantity check', {
      productId, requestedCount, localCount, totalQuantity, signPresent: !!sign,
    });

    return { productId, count: totalQuantity };
  }

  // ─── Sign verification ──────────────────────────────────────────────

  private async verifySign(
    providerAccountId: string,
    productId: string,
    count: number,
    sign: string,
    rawBody: string | null,
  ): Promise<boolean> {
    try {
      const secrets = await this.resolveProviderSecrets(providerAccountId);
      const apiKey = secrets['DIGISELLER_API_KEY'];
      const sellerId = secrets['DIGISELLER_SELLER_ID'] ?? '';

      if (!apiKey) {
        logger.warn('Quantity sign verification failed — DIGISELLER_API_KEY not found', { providerAccountId });
        await this.writeSignDiagnostic(productId, count, sign, 'missing_api_key', providerAccountId, rawBody);
        return false;
      }

      const candidates = [
        { name: 'product_id:count:apiKey', payload: `${productId}:${count}:${apiKey}` },
        { name: 'apiKey:product_id:count', payload: `${apiKey}:${productId}:${count}` },
        { name: 'product_id:count:apiKey (no colons)', payload: `${productId}${count}${apiKey}` },
        { name: 'apiKey:product_id:count:seller_id', payload: `${apiKey}:${productId}:${count}:${sellerId}` },
        { name: 'seller_id:product_id:count:apiKey', payload: `${sellerId}:${productId}:${count}:${apiKey}` },
        { name: 'product_id:count:seller_id:apiKey', payload: `${productId}:${count}:${sellerId}:${apiKey}` },
        { name: 'seller_id:product_id:count:seller_secret', payload: `${sellerId}${productId}${count}${apiKey}` },
      ];

      for (const c of candidates) {
        const expected = sha256Hex(c.payload);
        if (timingSafeCompare(expected.toLowerCase(), sign.toLowerCase())) {
          logger.info('Digiseller quantity sign matched', { matchedName: c.name });
          return true;
        }
      }

      await this.writeSignDiagnostic(productId, count, sign, 'sign_mismatch_all_formats', providerAccountId, rawBody);
      return false;
    } catch (err) {
      logger.warn('Quantity sign verification error — rejecting request', {
        providerAccountId, error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private async resolveProviderSecrets(providerAccountId: string): Promise<Record<string, string>> {
    const account = await this.db.queryOne<{
      provider_secrets_ref: Record<string, string> | null;
    }>('provider_accounts', {
      select: 'provider_secrets_ref',
      eq: [['id', providerAccountId]],
      single: true,
    });
    return (account?.provider_secrets_ref ?? {}) as Record<string, string>;
  }

  private async writeSignDiagnostic(
    productId: string,
    count: number,
    receivedSign: string,
    reason: string,
    providerAccountId: string,
    rawBody: string | null,
  ): Promise<void> {
    try {
      await this.db.insert('admin_alerts', {
        alert_type: 'digiseller_quantity_sign_diagnostic',
        severity: 'warning',
        title: `Digiseller quantity sign mismatch (product ${productId})`,
        message: `Reason: ${reason}. Check DIGISELLER_API_KEY configuration.`,
        metadata: {
          provider_account_id: providerAccountId,
          product_id: productId,
          count,
          received_sign: receivedSign,
          reason,
          raw_body: rawBody,
          observed_at: new Date().toISOString(),
        },
        requires_action: true,
        priority: 2,
      });
    } catch (err) {
      logger.warn('Failed to write quantity sign diagnostic', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
