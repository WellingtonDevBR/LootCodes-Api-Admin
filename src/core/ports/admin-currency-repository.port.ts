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
} from '../use-cases/currency/currency.types.js';

export interface IAdminCurrencyRepository {
  getCurrencyRates(): Promise<CurrencyRate[]>;
  addCurrencyRate(dto: AddCurrencyRateDto): Promise<CurrencyRate>;
  updateCurrencyRate(dto: UpdateCurrencyRateDto): Promise<void>;
  updateCurrencyMargin(dto: UpdateCurrencyMarginDto): Promise<void>;
  toggleCurrencyActive(dto: ToggleCurrencyActiveDto): Promise<boolean>;
  deleteCurrencyRate(dto: DeleteCurrencyRateDto): Promise<void>;
  syncCurrency(dto: SyncCurrencyDto): Promise<SyncCurrencyResult>;
  generateAllPrices(dto: GenerateAllPricesDto): Promise<GenerateAllPricesResult>;
}
