import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminCurrencyRepository } from '../../ports/admin-currency-repository.port.js';
import type { UpdateCurrencyRateDto } from './currency.types.js';

@injectable()
export class UpdateCurrencyRateUseCase {
  constructor(
    @inject(TOKENS.AdminCurrencyRepository) private currencyRepo: IAdminCurrencyRepository,
  ) {}

  async execute(dto: UpdateCurrencyRateDto): Promise<void> {
    return this.currencyRepo.updateCurrencyRate(dto);
  }
}
