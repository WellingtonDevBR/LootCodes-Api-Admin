import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminCurrencyRepository } from '../../core/ports/admin-currency-repository.port.js';
import type {
  SyncCurrencyDto,
  SyncCurrencyResult,
  UpdateCurrencyManualDto,
  UpdateCurrencyManualResult,
  GetCurrencyRatesResult,
} from '../../core/use-cases/currency/currency.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminCurrencyRepository');

@injectable()
export class SupabaseAdminCurrencyRepository implements IAdminCurrencyRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async syncCurrency(dto: SyncCurrencyDto): Promise<SyncCurrencyResult> {
    logger.info('Syncing currency rates', { adminId: dto.admin_id });

    const result = await this.db.rpc<{ rates_updated: number }>(
      'generate_all_localized_prices',
      {},
    );

    return { success: true, rates_updated: result.rates_updated ?? 0 };
  }

  async updateCurrencyManual(dto: UpdateCurrencyManualDto): Promise<UpdateCurrencyManualResult> {
    logger.info('Manually updating currency rate', { code: dto.currency_code, rate: dto.rate, adminId: dto.admin_id });

    await this.db.upsert(
      'currency_rates',
      {
        code: dto.currency_code,
        rate: dto.rate,
        updated_at: new Date().toISOString(),
      },
      'code',
    );

    await this.db.rpc('generate_all_localized_prices', {});

    return { success: true };
  }

  async getCurrencyRates(): Promise<GetCurrencyRatesResult> {
    const rates = await this.db.query<{ code: string; rate: number; updated_at: string }>(
      'currency_rates',
      { order: { column: 'code', ascending: true } },
    );

    return { rates };
  }
}
