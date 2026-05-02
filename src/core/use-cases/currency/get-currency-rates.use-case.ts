import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminCurrencyRepository } from '../../ports/admin-currency-repository.port.js';
import type { GetCurrencyRatesResult } from './currency.types.js';

@injectable()
export class GetCurrencyRatesUseCase {
  constructor(
    @inject(TOKENS.AdminCurrencyRepository) private currencyRepo: IAdminCurrencyRepository,
  ) {}

  async execute(): Promise<GetCurrencyRatesResult> {
    return this.currencyRepo.getCurrencyRates();
  }
}
