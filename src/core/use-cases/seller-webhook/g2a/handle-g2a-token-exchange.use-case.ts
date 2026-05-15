import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import { resolveProviderSecrets } from '../../../../infra/marketplace/resolve-provider-secrets.js';
import { timingSafeEqual } from '../../../../infra/marketplace/_shared/marketplace-http.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('handle-g2a-token-exchange');

const G2A_TOKEN_EXPIRY_SECONDS = 3600;

export interface G2ATokenExchangeDto {
  grantType: string;
  clientId: string;
  clientSecret: string;
}

export interface G2ATokenExchangeResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Validates G2A client credentials, lazily provisions `g2a_callback_auth_token`
 * if missing, and returns the OAuth2 token-exchange response. Pulled out of the
 * route handler so the seller-webhook routes stay free of `IDatabase` access.
 */
@injectable()
export class HandleG2ATokenExchangeUseCase {
  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async execute(dto: G2ATokenExchangeDto): Promise<G2ATokenExchangeResult> {
    if (dto.grantType !== 'client_credentials') {
      logger.warn('G2A token request with invalid grant_type', { grantType: dto.grantType });
      return { status: 400, body: { error: 'unsupported_grant_type' } };
    }

    const account = await this.db.queryOne<{
      id: string;
      seller_config: Record<string, unknown>;
    }>('provider_accounts', {
      select: 'id, seller_config',
      eq: [['provider_code', 'g2a'], ['supports_seller', true]],
      single: true,
    });

    if (!account) {
      logger.error('G2A seller provider account not found');
      return { status: 500, body: { error: 'server_error' } };
    }

    const secrets = await resolveProviderSecrets(this.db, account.id);
    const expectedClientId = secrets['G2A_CLIENT_ID'] ?? '';
    const expectedClientSecret = secrets['G2A_CLIENT_SECRET'] ?? '';

    if (
      !expectedClientId ||
      !expectedClientSecret ||
      !timingSafeEqual(dto.clientId, expectedClientId) ||
      !timingSafeEqual(dto.clientSecret, expectedClientSecret)
    ) {
      logger.warn('G2A token request with invalid credentials');
      return { status: 401, body: { error: 'invalid_client' } };
    }

    const sellerConfig = (account.seller_config ?? {}) as Record<string, unknown>;
    let callbackToken = sellerConfig.g2a_callback_auth_token as string | undefined;

    if (!callbackToken) {
      callbackToken = randomUUID();
      const updatedConfig = { ...sellerConfig, g2a_callback_auth_token: callbackToken };
      await this.db.update('provider_accounts', { id: account.id }, { seller_config: updatedConfig });
      logger.info('Auto-generated g2a_callback_auth_token', { accountId: account.id });
    }

    return {
      status: 200,
      body: {
        access_token: callbackToken,
        token_type: 'bearer',
        expires_in: G2A_TOKEN_EXPIRY_SECONDS,
      },
    };
  }
}
