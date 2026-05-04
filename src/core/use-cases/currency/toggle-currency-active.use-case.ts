import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminCurrencyRepository } from '../../ports/admin-currency-repository.port.js';
import type { ToggleCurrencyActiveDto } from './currency.types.js';

@injectable()
export class ToggleCurrencyActiveUseCase {
  constructor(
    @inject(TOKENS.AdminCurrencyRepository) private currencyRepo: IAdminCurrencyRepository,
  ) {}

  async execute(dto: ToggleCurrencyActiveDto): Promise<boolean> {
    return this.currencyRepo.toggleCurrencyActive(dto);
  }
}
