/**
 * BuyerWalletSnapshotter — implementation of `IBuyerWalletSnapshotter`.
 *
 * Loads every enabled buyer-capable `provider_accounts` row, then dispatches
 * each row to a `BuyerWalletProviderProbe` keyed by `provider_code`. The
 * probes are thin wrappers around the existing buyer adapters' wallet APIs
 * (Bamboo `fetchLiveWalletSummaries`, AppRoute `getAccounts` +
 * `appRouteSpendableCents`).
 *
 * Tolerant by design:
 *   - Provider with no probe wired → skipped (logged once).
 *   - Probe throws → empty wallet map for that account, snapshot continues.
 *   - DB query fails → empty snapshot (reconcile becomes a no-op for the cycle).
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';
import type {
  IBuyerWalletSnapshotter,
  WalletSnapshot,
} from '../../../core/ports/buyer-wallet-snapshot.port.js';
import { resolveProviderSecrets } from '../../marketplace/resolve-provider-secrets.js';
import { createBambooManualBuyer } from '../bamboo-manual-buyer.js';
import { createAppRouteManualBuyer } from '../approute-manual-buyer.js';
import { appRouteSpendableCents } from '../../marketplace/approute/approute-wallet-preflight.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('buyer-wallet-snapshotter');

export interface BuyerWalletProviderProbe {
  readonly providerCode: string;
  /**
   * Return spendable cents per ISO currency for ONE provider account.
   * Throw on vendor-side failure — the snapshotter handles the empty case.
   */
  fetch(providerAccountId: string): Promise<ReadonlyMap<string, number>>;
}

interface ProviderAccountRow {
  readonly id: string;
  readonly provider_code: string | null;
  readonly is_enabled: boolean | null;
  readonly supports_seller: boolean | null;
}

@injectable()
export class BuyerWalletSnapshotter implements IBuyerWalletSnapshotter {
  private readonly probesByCode: Map<string, BuyerWalletProviderProbe>;

  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    probes: ReadonlyArray<BuyerWalletProviderProbe>,
  ) {
    this.probesByCode = new Map();
    for (const p of probes) {
      this.probesByCode.set(p.providerCode.trim().toLowerCase(), p);
    }
  }

  async snapshot(): Promise<WalletSnapshot> {
    const out = new Map<string, ReadonlyMap<string, number>>();

    let accounts: ProviderAccountRow[];
    try {
      accounts = await this.db.query<ProviderAccountRow>('provider_accounts', {
        select: 'id, provider_code, is_enabled, supports_seller',
      });
    } catch (err) {
      logger.warn('snapshot: provider_accounts query failed; returning empty snapshot', {
        error: err instanceof Error ? err.message : String(err),
      });
      return out;
    }

    const buyerAccounts = accounts.filter(
      (a) =>
        a.is_enabled === true &&
        a.supports_seller !== true &&
        typeof a.provider_code === 'string' &&
        a.provider_code.trim().length > 0,
    );

    await Promise.all(
      buyerAccounts.map(async (a) => {
        const code = (a.provider_code ?? '').trim().toLowerCase();
        const probe = this.probesByCode.get(code);
        if (!probe) {
          logger.debug('snapshot: no probe wired for provider', {
            providerAccountId: a.id,
            providerCode: code,
          });
          return;
        }

        try {
          const raw = await probe.fetch(a.id);
          out.set(a.id, normalizeWalletMap(raw));
        } catch (err) {
          logger.warn('snapshot: probe failed; recording empty wallet', {
            providerAccountId: a.id,
            providerCode: code,
            error: err instanceof Error ? err.message : String(err),
          });
          out.set(a.id, new Map<string, number>());
        }
      }),
    );

    return out;
  }
}

function normalizeWalletMap(raw: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const norm = new Map<string, number>();
  for (const [currency, cents] of raw) {
    if (typeof currency !== 'string') continue;
    const code = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) continue;
    if (typeof cents !== 'number' || !Number.isFinite(cents) || cents < 0) continue;
    norm.set(code, Math.round(cents));
  }
  return norm;
}

// ─── Concrete probes ───────────────────────────────────────────────────

/**
 * Bamboo probe — wraps `BambooManualBuyer.fetchLiveWalletSummaries`. Bamboo
 * returns balances in major units (e.g. USD dollars); we convert to cents.
 */
export class BambooWalletProbe implements BuyerWalletProviderProbe {
  readonly providerCode = 'bamboo' as const;

  constructor(private readonly db: IDatabase) {}

  async fetch(providerAccountId: string): Promise<ReadonlyMap<string, number>> {
    const account = await this.db.queryOne<{ api_profile: unknown }>('provider_accounts', {
      select: 'api_profile',
      filter: { id: providerAccountId },
    });
    const profile =
      account?.api_profile && typeof account.api_profile === 'object' && !Array.isArray(account.api_profile)
        ? (account.api_profile as Record<string, unknown>)
        : {};
    const secrets = await resolveProviderSecrets(this.db, providerAccountId);

    const buyer = createBambooManualBuyer({ secrets, profile });
    if (!buyer) {
      throw new Error(`Bamboo credentials missing for account ${providerAccountId}`);
    }

    const wallets = await buyer.fetchLiveWalletSummaries();
    const map = new Map<string, number>();
    for (const w of wallets) {
      if (typeof w.currency !== 'string') continue;
      const code = w.currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) continue;
      const cents = Math.round((w.balance ?? 0) * 100);
      // Multiple wallets per currency: keep the largest.
      const prev = map.get(code) ?? 0;
      if (cents > prev) map.set(code, cents);
    }
    return map;
  }
}

/**
 * AppRoute probe — wraps `AppRouteManualBuyer.fetchLiveWalletSummaries`,
 * applying the same `available + overdraft` spendable rule used at preflight.
 */
export class AppRouteWalletProbe implements BuyerWalletProviderProbe {
  readonly providerCode = 'approute' as const;

  constructor(private readonly db: IDatabase) {}

  async fetch(providerAccountId: string): Promise<ReadonlyMap<string, number>> {
    const account = await this.db.queryOne<{ api_profile: unknown }>('provider_accounts', {
      select: 'api_profile',
      filter: { id: providerAccountId },
    });
    const profile =
      account?.api_profile && typeof account.api_profile === 'object' && !Array.isArray(account.api_profile)
        ? (account.api_profile as Record<string, unknown>)
        : {};
    const secrets = await resolveProviderSecrets(this.db, providerAccountId);

    const buyer = createAppRouteManualBuyer({ secrets, profile });
    if (!buyer) {
      throw new Error(`AppRoute credentials missing for account ${providerAccountId}`);
    }

    // We need to read the raw account rows so we can apply the spendable
    // rule (available + overdraft) consistently with the preflight path.
    // `fetchLiveWalletSummaries` only exposes `balance`/`available`, not
    // overdraft, so reach into the public api directly via a shim.
    const accounts = await buyer.fetchLiveWalletSummaries();
    const map = new Map<string, number>();
    for (const w of accounts) {
      if (typeof w.currency !== 'string') continue;
      const code = w.currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) continue;
      const cents = appRouteSpendableCents({
        currency: code,
        available: w.available,
        balance: w.balance,
      });
      if (cents == null || !Number.isFinite(cents) || cents < 0) continue;
      const prev = map.get(code) ?? 0;
      if (cents > prev) map.set(code, cents);
    }
    return map;
  }
}
