/**
 * Supabase-backed FX converter for procurement comparisons.
 *
 * Reads `public.currency_rates` (USD anchored: `from_currency='USD'`) and
 * inverts the rate when converting XXX → USD:
 *
 *   usd_cents = native_cents / rate(USD → XXX)
 *
 * Margin (`margin_pct`) is intentionally ignored — that's a storefront
 * concern, not a procurement comparison concern.
 *
 * Caches the active rate map for the lifetime of the converter instance to
 * avoid hammering the DB inside one JIT run. Construct a new instance per
 * request when freshness matters.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IProcurementFxConverter } from '../../core/ports/procurement-fx-converter.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('procurement-fx-converter');

interface CurrencyRateRow {
  readonly to_currency: string | null;
  readonly rate: number | string | null;
  readonly is_active: boolean | null;
}

@injectable()
export class SupabaseProcurementFxConverter implements IProcurementFxConverter {
  /** Cache of `to_currency → rate (USD→XXX)`. */
  private readonly rateCache: Map<string, number> = new Map();
  private cacheLoaded = false;

  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async toUsdCents(cents: number, from: string): Promise<number | null> {
    if (!Number.isFinite(cents)) return null;
    const code = normalizeCurrencyCode(from);
    if (!code) return null;
    if (code === 'USD') return Math.round(cents);

    await this.ensureCacheLoaded();
    const rate = this.rateCache.get(code);
    if (rate == null || !Number.isFinite(rate) || rate <= 0) {
      return null;
    }

    return Math.round(cents / rate);
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (this.cacheLoaded) return;

    const rows = await this.db.query<CurrencyRateRow>('currency_rates', {
      select: 'to_currency, rate, is_active',
      eq: [
        ['from_currency', 'USD'],
        ['is_active', true],
      ],
    });

    for (const row of rows) {
      const code = typeof row.to_currency === 'string' ? row.to_currency.trim().toUpperCase() : '';
      if (!code) continue;
      const rate = typeof row.rate === 'number' ? row.rate : Number(row.rate);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      this.rateCache.set(code, rate);
    }

    this.cacheLoaded = true;
    logger.debug('FX cache loaded', { entries: this.rateCache.size });
  }
}

function normalizeCurrencyCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
}
