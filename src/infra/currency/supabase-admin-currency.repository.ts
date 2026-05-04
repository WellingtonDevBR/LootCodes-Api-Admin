import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminCurrencyRepository } from '../../core/ports/admin-currency-repository.port.js';
import type {
  CurrencyRate,
  AddCurrencyRateDto,
  UpdateCurrencyRateDto,
  UpdateCurrencyMarginDto,
  ToggleCurrencyActiveDto,
  DeleteCurrencyRateDto,
  SyncCurrencyDto,
  SyncCurrencyResult,
  GenerateAllPricesDto,
  GenerateAllPricesResult,
} from '../../core/use-cases/currency/currency.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminCurrencyRepository');

const CURRENCY_COLUMNS =
  'id, from_currency, to_currency, rate, margin_pct, last_updated, source, is_active';

@injectable()
export class SupabaseAdminCurrencyRepository implements IAdminCurrencyRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async getCurrencyRates(): Promise<CurrencyRate[]> {
    return this.db.query<CurrencyRate>('currency_rates', {
      select: CURRENCY_COLUMNS,
      eq: [['from_currency', 'USD']],
      order: { column: 'to_currency', ascending: true },
    });
  }

  async addCurrencyRate(dto: AddCurrencyRateDto): Promise<CurrencyRate> {
    logger.info('Adding currency rate', { currency: dto.to_currency, adminId: dto.admin_id });

    const row = await this.db.insert<CurrencyRate>('currency_rates', {
      from_currency: 'USD',
      to_currency: dto.to_currency.toUpperCase(),
      rate: dto.rate,
      source: 'manual',
      is_active: true,
      margin_pct: 0,
      last_updated: new Date().toISOString(),
    });

    return row;
  }

  async updateCurrencyRate(dto: UpdateCurrencyRateDto): Promise<void> {
    logger.info('Updating currency rate', { id: dto.id, rate: dto.rate, adminId: dto.admin_id });

    await this.db.update('currency_rates', { id: dto.id }, {
      rate: dto.rate,
      source: 'manual',
      last_updated: new Date().toISOString(),
    });
  }

  async updateCurrencyMargin(dto: UpdateCurrencyMarginDto): Promise<void> {
    logger.info('Updating currency margin', { id: dto.id, marginPct: dto.margin_pct, adminId: dto.admin_id });

    await this.db.update('currency_rates', { id: dto.id }, {
      margin_pct: dto.margin_pct,
      last_updated: new Date().toISOString(),
    });
  }

  async toggleCurrencyActive(dto: ToggleCurrencyActiveDto): Promise<boolean> {
    logger.info('Toggling currency active status', { id: dto.id, adminId: dto.admin_id });

    const existing = await this.db.queryOne<CurrencyRate>('currency_rates', {
      select: 'is_active',
      filter: { id: dto.id },
    });

    if (!existing) throw new Error(`Currency rate ${dto.id} not found`);

    const newActive = !existing.is_active;
    await this.db.update('currency_rates', { id: dto.id }, { is_active: newActive });

    return newActive;
  }

  async deleteCurrencyRate(dto: DeleteCurrencyRateDto): Promise<void> {
    logger.info('Deleting currency rate', { id: dto.id, adminId: dto.admin_id });

    await this.db.delete('currency_rates', { id: dto.id });
  }

  async syncCurrency(dto: SyncCurrencyDto): Promise<SyncCurrencyResult> {
    logger.info('Syncing currency rates from external source', { adminId: dto.admin_id });

    const result = await this.db.rpc<{ message?: string }>('sync_currency_and_update_prices', {});

    return { success: true, message: result?.message ?? 'Sync completed' };
  }

  async generateAllPrices(dto: GenerateAllPricesDto): Promise<GenerateAllPricesResult> {
    logger.info('Generating all localized prices', { adminId: dto.admin_id });

    const result = await this.db.rpc<GenerateAllPricesResult>('generate_all_localized_prices', {});

    return {
      success: true,
      inserted: result?.inserted ?? 0,
      updated: result?.updated ?? 0,
      errors: result?.errors ?? 0,
      message: result?.message,
    };
  }
}
