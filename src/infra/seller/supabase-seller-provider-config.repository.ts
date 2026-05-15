/**
 * Supabase implementation of {@link ISellerProviderConfigRepository}.
 *
 * Caches parsed configs in a per-process Map with a short TTL. The TTL is
 * deliberately small (60 s) so admin writes to `provider_accounts.seller_config`
 * propagate to the cron orchestrator on the next tick without a deploy.
 * Callers that need stronger consistency (e.g. an admin UI mutation followed by
 * an immediate read for confirmation) MUST call {@link invalidate} after the
 * mutation.
 *
 * Cache is keyed by both `account_id` and `provider_code` so the two lookup
 * methods share one source of truth — `getByProviderCode` populates the
 * `account_id` entry as well, and vice-versa.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { ISellerProviderConfigRepository } from '../../core/ports/seller-provider-config-repository.port.js';
import {
  parseSellerConfig,
  type SellerProviderConfig,
} from '../../core/use-cases/seller/seller.types.js';

const TTL_MS = 60_000;

interface CacheEntry {
  readonly config: SellerProviderConfig;
  readonly accountId: string;
  readonly providerCode: string;
  readonly fetchedAt: number;
}

@injectable()
export class SupabaseSellerProviderConfigRepository implements ISellerProviderConfigRepository {
  private readonly byAccount = new Map<string, CacheEntry>();
  private readonly byProvider = new Map<string, CacheEntry>();

  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async getByAccountId(accountId: string): Promise<SellerProviderConfig | null> {
    const cached = this.byAccount.get(accountId);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached.config;
    }

    const account = await this.db.queryOne<{
      readonly id: string;
      readonly provider_code: string;
      readonly seller_config: Record<string, unknown> | null;
    }>('provider_accounts', {
      filter: { id: accountId },
      select: 'id, provider_code, seller_config',
    });
    if (!account) return null;

    return this.cache(account.id, account.provider_code, account.seller_config);
  }

  async getByProviderCode(providerCode: string): Promise<SellerProviderConfig | null> {
    const cached = this.byProvider.get(providerCode);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached.config;
    }

    // `is_enabled = true` to avoid returning rows for retired accounts; ordered
    // by `priority` so the highest-priority active account wins when a test
    // duplicate is left behind.
    const rows = await this.db.query<{
      readonly id: string;
      readonly provider_code: string;
      readonly seller_config: Record<string, unknown> | null;
    }>('provider_accounts', {
      eq: [
        ['provider_code', providerCode],
        ['is_enabled', true],
      ],
      order: { column: 'priority', ascending: true },
      select: 'id, provider_code, seller_config',
      limit: 1,
    });
    const account = rows[0];
    if (!account) return null;

    return this.cache(account.id, account.provider_code, account.seller_config);
  }

  invalidate(keyOrAccountId: string): void {
    const accountEntry = this.byAccount.get(keyOrAccountId);
    if (accountEntry) {
      this.byAccount.delete(keyOrAccountId);
      this.byProvider.delete(accountEntry.providerCode);
      return;
    }
    const providerEntry = this.byProvider.get(keyOrAccountId);
    if (providerEntry) {
      this.byProvider.delete(keyOrAccountId);
      this.byAccount.delete(providerEntry.accountId);
    }
  }

  clear(): void {
    this.byAccount.clear();
    this.byProvider.clear();
  }

  private cache(
    accountId: string,
    providerCode: string,
    raw: Record<string, unknown> | null,
  ): SellerProviderConfig {
    const config = parseSellerConfig(raw ?? {});
    const entry: CacheEntry = { config, accountId, providerCode, fetchedAt: Date.now() };
    this.byAccount.set(accountId, entry);
    this.byProvider.set(providerCode, entry);
    return config;
  }
}
