import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminCurrencyRepository } from '../../ports/admin-currency-repository.port.js';
import type { UpdateCurrencyMarginDto } from './currency.types.js';

@injectable()
export class UpdateCurrencyMarginUseCase {
  constructor(
    @inject(TOKENS.AdminCurrencyRepository) private currencyRepo: IAdminCurrencyRepository,
  ) {}

  async execute(dto: UpdateCurrencyMarginDto): Promise<void> {
    return this.currencyRepo.updateCurrencyMargin(dto);
  }
}
