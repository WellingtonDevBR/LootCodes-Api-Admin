/**
 * Resolves the right `IBuyerProvider` adapter for a `provider_accounts.id`.
 *
 * Returns `null` when:
 *   - the account does not exist or is disabled,
 *   - the provider is sell-only (`supports_seller = true`),
 *   - the credentials / api_profile are not configured (the underlying
 *     `createXxxManualBuyer` factory returns null).
 *
 * Callers MUST handle a `null` resolution by skipping that candidate.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';
import type { IBuyerProvider, IBuyerProviderRegistry } from '../../../core/ports/buyer-provider.port.js';
import { resolveProviderSecrets } from '../../marketplace/resolve-provider-secrets.js';
import { createBambooManualBuyer } from '../bamboo-manual-buyer.js';
import { createAppRouteManualBuyer } from '../approute-manual-buyer.js';
import { createWgcardsManualBuyer } from '../wgcards/wgcards-manual-buyer.js';
import type { BuyerManualPurchaseService } from '../buyer-manual-purchase.service.js';
import { BambooBuyerProvider } from './bamboo-buyer-provider.js';
import { AppRouteBuyerProvider } from './approute-buyer-provider.js';
import { WgcardsBuyerProvider } from '../wgcards/wgcards-buyer-provider.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('buyer-provider-registry');

interface ProviderAccountRow {
  readonly id: string;
  readonly provider_code: string | null;
  readonly is_enabled: boolean | null;
  readonly supports_seller: boolean | null;
  readonly api_profile: unknown;
  readonly cached_token: unknown;
}

function asApiProfile(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function asWgcardsTokenCache(
  raw: unknown,
): { accessToken: string; expiresAt: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj['accessToken'] === 'string' && typeof obj['expiresAt'] === 'number') {
    return { accessToken: obj['accessToken'], expiresAt: obj['expiresAt'] };
  }
  return null;
}

@injectable()
export class BuyerProviderRegistry implements IBuyerProviderRegistry {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.BuyerManualPurchaseService)
    private readonly service: BuyerManualPurchaseService,
  ) {}

  async resolve(providerAccountId: string): Promise<IBuyerProvider | null> {
    const account = await this.db.queryOne<ProviderAccountRow>('provider_accounts', {
      select: 'id, provider_code, is_enabled, supports_seller, api_profile, cached_token',
      filter: { id: providerAccountId },
    });

    if (!account || account.is_enabled !== true) {
      logger.debug('registry: account missing or disabled', { providerAccountId });
      return null;
    }

    if (account.supports_seller === true) {
      logger.debug('registry: account is seller-only — skipping', { providerAccountId });
      return null;
    }

    const code = (account.provider_code ?? '').trim().toLowerCase();
    if (!code) return null;

    const apiProfile = asApiProfile(account.api_profile);
    const secrets = await resolveProviderSecrets(this.db, providerAccountId);

    if (code === 'bamboo') {
      const buyer = createBambooManualBuyer({ secrets, profile: apiProfile });
      if (!buyer) {
        logger.warn('registry: Bamboo credentials missing', { providerAccountId });
        return null;
      }
      return new BambooBuyerProvider(providerAccountId, buyer, this.service);
    }

    if (code === 'approute') {
      const buyer = createAppRouteManualBuyer({ secrets, profile: apiProfile });
      if (!buyer) {
        logger.warn('registry: AppRoute credentials missing', { providerAccountId });
        return null;
      }
      return new AppRouteBuyerProvider(providerAccountId, buyer, this.service);
    }

    if (code === 'wgcards') {
      const initialTokenCache = asWgcardsTokenCache(account.cached_token);
      const buyer = createWgcardsManualBuyer({
        secrets,
        profile: apiProfile,
        initialTokenCache,
        onTokenRefreshed: (entry) => {
          this.db.update('provider_accounts', { id: providerAccountId }, { cached_token: entry }).catch(
            (err: unknown) => {
              logger.warn('WGCards: failed to persist refreshed token to DB', {
                providerAccountId,
                error: err instanceof Error ? err.message : String(err),
              });
            },
          );
        },
      });
      if (!buyer) {
        logger.warn('registry: WGCards credentials missing', { providerAccountId });
        return null;
      }
      return new WgcardsBuyerProvider(providerAccountId, buyer, this.service);
    }

    logger.debug('registry: provider has no buyer adapter', { providerAccountId, code });
    return null;
  }
}
