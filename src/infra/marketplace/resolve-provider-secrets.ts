/**
 * Resolves provider API secrets via `provider_secrets_ref` + Vault RPC,
 * matching the Edge `provider-procurement` bootstrap pattern.
 */
import type { IDatabase } from '../../core/ports/database.port.js';
import { getEnv, getOptionalEnvVar } from '../../config/env.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('resolve-provider-secrets');

interface SecretRefRow {
  secret_name: string;
  vault_secret_id: string | null;
}

export async function resolveProviderSecrets(
  db: IDatabase,
  providerAccountId: string,
): Promise<Record<string, string>> {
  const refs = await db.query<SecretRefRow>('provider_secrets_ref', {
    select: 'secret_name, vault_secret_id',
    eq: [
      ['provider_account_id', providerAccountId],
      ['is_active', true],
    ],
  });

  if (refs.length === 0) {
    logger.warn('No active secret refs for provider account', { providerAccountId });
    return {};
  }

  const isProd = getEnv().NODE_ENV === 'production';
  const secrets: Record<string, string> = {};

  for (const ref of refs) {
    let value: string | undefined;

    if (ref.vault_secret_id) {
      value = (await readVaultSecret(db, ref.vault_secret_id)) ?? undefined;
    }

    if (!value) {
      value = getOptionalEnvVar(ref.secret_name);
      if (value && isProd) {
        logger.warn('Production env-var fallback for provider secret', {
          providerAccountId,
          secretName: ref.secret_name,
          hadVaultLink: !!ref.vault_secret_id,
        });
      } else if (value && !isProd) {
        logger.warn('Resolved provider secret from env (non-production)', {
          providerAccountId,
          secretName: ref.secret_name,
        });
      }
    }

    if (value) {
      secrets[ref.secret_name] = value;
    } else {
      logger.warn('Provider secret unresolved', {
        providerAccountId,
        secretName: ref.secret_name,
        hadVaultLink: !!ref.vault_secret_id,
      });
    }
  }

  return secrets;
}

async function readVaultSecret(db: IDatabase, vaultSecretId: string): Promise<string | null> {
  try {
    const data = await db.rpc<string | null>('get_vault_secret', { p_secret_id: vaultSecretId });
    if (typeof data === 'string' && data.length > 0) {
      return data;
    }
  } catch (err) {
    logger.warn('Vault RPC failed for secret', {
      vaultSecretId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}
