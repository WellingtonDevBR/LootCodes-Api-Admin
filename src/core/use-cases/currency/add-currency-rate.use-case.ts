import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminCurrencyRepository } from '../../ports/admin-currency-repository.port.js';
import type { AddCurrencyRateDto, CurrencyRate } from './currency.types.js';

@injectable()
export class AddCurrencyRateUseCase {
  constructor(
    @inject(TOKENS.AdminCurrencyRepository) private currencyRepo: IAdminCurrencyRepository,
  ) {}

  async execute(dto: AddCurrencyRateDto): Promise<CurrencyRate> {
    return this.currencyRepo.addCurrencyRate(dto);
  }
}
