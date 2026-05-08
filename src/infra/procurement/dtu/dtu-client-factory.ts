/**
 * DtuClientFactory — resolves the right `IDtuClient` adapter for a
 * `provider_accounts.id`.
 *
 * Today only AppRoute supports DTU. Returns `null` for any other provider
 * (including disabled accounts and missing credentials).
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';
import type { IDtuClient, IDtuClientFactory } from '../../../core/ports/dtu-client.port.js';
import { resolveProviderSecrets } from '../../marketplace/resolve-provider-secrets.js';
import { resolveAppRouteBaseUrlFromApiProfile } from '../../marketplace/approute/resolve-app-route-base-url.js';
import { createAppRouteMarketplaceHttpClient } from '../../marketplace/approute/create-app-route-http-client.js';
import { AppRoutePublicApi } from '../../marketplace/approute/app-route-public-api.js';
import { AppRouteDtuClient } from './approute-dtu-client.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('dtu-client-factory');

interface ProviderAccountRow {
  readonly id: string;
  readonly provider_code: string | null;
  readonly is_enabled: boolean | null;
  readonly api_profile: unknown;
}

function asApiProfile(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

@injectable()
export class DtuClientFactory implements IDtuClientFactory {
  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async resolve(providerAccountId: string): Promise<IDtuClient | null> {
    const row = await this.db.queryOne<ProviderAccountRow>('provider_accounts', {
      select: 'id, provider_code, is_enabled, api_profile',
      filter: { id: providerAccountId },
    });

    if (!row || row.is_enabled !== true) {
      logger.debug('DTU factory: account missing or disabled', { providerAccountId });
      return null;
    }

    const code = (row.provider_code ?? '').trim().toLowerCase();
    if (code !== 'approute') {
      logger.debug('DTU factory: provider does not support DTU yet', { providerAccountId, code });
      return null;
    }

    const apiProfile = asApiProfile(row.api_profile);
    const secrets = await resolveProviderSecrets(this.db, providerAccountId);
    const apiKey = secrets['APPROUTE_API_KEY'];
    const baseUrl = resolveAppRouteBaseUrlFromApiProfile(apiProfile);
    if (!apiKey?.trim() || !baseUrl?.trim()) {
      logger.warn('DTU factory: AppRoute credentials missing', { providerAccountId });
      return null;
    }

    const http = createAppRouteMarketplaceHttpClient({
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
    });
    return new AppRouteDtuClient(new AppRoutePublicApi(http));
  }
}
