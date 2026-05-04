import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminCurrencyRepository } from '../../ports/admin-currency-repository.port.js';
import type { DeleteCurrencyRateDto } from './currency.types.js';

@injectable()
export class DeleteCurrencyRateUseCase {
  constructor(
    @inject(TOKENS.AdminCurrencyRepository) private currencyRepo: IAdminCurrencyRepository,
  ) {}

  async execute(dto: DeleteCurrencyRateDto): Promise<void> {
    return this.currencyRepo.deleteCurrencyRate(dto);
  }
}
