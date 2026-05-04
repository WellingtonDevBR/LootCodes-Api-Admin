import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminCurrencyRepository } from '../../ports/admin-currency-repository.port.js';
import type { CurrencyRate } from './currency.types.js';

@injectable()
export class GetCurrencyRatesUseCase {
  constructor(
    @inject(TOKENS.AdminCurrencyRepository) private currencyRepo: IAdminCurrencyRepository,
  ) {}

  async execute(): Promise<CurrencyRate[]> {
    return this.currencyRepo.getCurrencyRates();
  }
}
