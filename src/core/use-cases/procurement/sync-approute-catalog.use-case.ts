import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import {
  syncAppRouteProductCatalog,
  type SyncAppRouteCatalogResult,
} from '../../../infra/procurement/approute-catalog-sync.js';

export interface SyncAppRouteCatalogDto {
  provider_account_id?: string;
}

export type SyncAppRouteCatalogOutcome =
  | { readonly status: 200; readonly body: SyncAppRouteCatalogResult }
  | { readonly status: 400; readonly body: { success: false; error: string } }
  | { readonly status: 502; readonly body: SyncAppRouteCatalogResult };

/**
 * Admin trigger for the AppRoute catalog ingestion job.
 *
 * Resolves the target provider account (either explicit or the single enabled
 * `approute` row) and delegates to `syncAppRouteProductCatalog`. Returns a
 * pre-shaped HTTP status + body so the route handler stays trivial.
 */
@injectable()
export class SyncAppRouteCatalogUseCase {
  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async execute(dto: SyncAppRouteCatalogDto): Promise<SyncAppRouteCatalogOutcome> {
    let accountId = typeof dto.provider_account_id === 'string'
      ? dto.provider_account_id.trim()
      : '';

    if (!accountId) {
      const rows = await this.db.query<{ id: string }>('provider_accounts', {
        select: 'id',
        eq: [
          ['provider_code', 'approute'],
          ['is_enabled', true],
        ],
        limit: 1,
      });
      accountId = rows[0]?.id ?? '';
    }

    if (!accountId) {
      return {
        status: 400,
        body: {
          success: false,
          error:
            'No enabled approute provider account found \u2014 create one or pass provider_account_id explicitly.',
        },
      };
    }

    const verify = await this.db.queryOne<{ provider_code: string; is_enabled: boolean }>(
      'provider_accounts',
      { select: 'provider_code, is_enabled', filter: { id: accountId } },
    );
    if (!verify?.is_enabled || verify.provider_code.trim().toLowerCase() !== 'approute') {
      return {
        status: 400,
        body: {
          success: false,
          error:
            'provider_account_id must reference an enabled provider_accounts row with provider_code approute',
        },
      };
    }

    const result = await syncAppRouteProductCatalog(this.db, accountId);
    return result.success ? { status: 200, body: result } : { status: 502, body: result };
  }
}
