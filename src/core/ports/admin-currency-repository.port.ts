import type {
  SyncCurrencyDto,
  SyncCurrencyResult,
  UpdateCurrencyManualDto,
  UpdateCurrencyManualResult,
  GetCurrencyRatesResult,
} from '../use-cases/currency/currency.types.js';

export interface IAdminCurrencyRepository {
  syncCurrency(dto: SyncCurrencyDto): Promise<SyncCurrencyResult>;
  updateCurrencyManual(dto: UpdateCurrencyManualDto): Promise<UpdateCurrencyManualResult>;
  getCurrencyRates(): Promise<GetCurrencyRatesResult>;
}
