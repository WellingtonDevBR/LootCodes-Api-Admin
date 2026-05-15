/**
 * Supabase-backed currency-rates reader with a short in-memory TTL cache.
 *
 * Owns the cache that previously lived as module-level state in
 * `http/routes/_currency-helpers.ts`. Moving the cache into the repository
 * means:
 *
 *   - Routes no longer resolve `IDatabase` just to read currency rates.
 *   - Tests can swap the port for a fixture map without touching the cache.
 *   - The invalidation API stays minimal (`invalidate()`).
 *
 * Coalesces concurrent first-loads through `inflight` so a request stampede
 * doesn't trigger N parallel `SELECT * FROM currency_rates`.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { ICurrencyRatesRepository, RateMap } from '../../core/ports/currency-rates-repository.port.js';

const TTL_MS = 60_000;

@injectable()
export class SupabaseCurrencyRatesRepository implements ICurrencyRatesRepository {
  private cached: RateMap | null = null;
  private cachedAt = 0;
  private inflight: Promise<RateMap> | null = null;

  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async getActiveRates(): Promise<RateMap> {
    const now = Date.now();
    if (this.cached !== null && now - this.cachedAt < TTL_MS) {
      return this.cached;
    }
    if (this.inflight !== null) return this.inflight;

    this.inflight = (async () => {
      try {
        const rows = await this.db.query<{
          from_currency: string;
          to_currency: string;
          rate: string | number;
        }>('currency_rates', {
          select: 'from_currency, to_currency, rate',
          eq: [['is_active', true]],
        });
        const map: RateMap = new Map();
        for (const r of rows) {
          const rate = typeof r.rate === 'number' ? r.rate : Number(r.rate);
          if (!Number.isFinite(rate) || rate <= 0) continue;
          map.set(`${r.from_currency}->${r.to_currency}`, rate);
        }
        this.cached = map;
        this.cachedAt = Date.now();
        return map;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  invalidate(): void {
    this.cached = null;
    this.cachedAt = 0;
  }
}
