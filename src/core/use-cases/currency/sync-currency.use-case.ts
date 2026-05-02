import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminCurrencyRepository } from '../../ports/admin-currency-repository.port.js';
import type { SyncCurrencyDto, SyncCurrencyResult } from './currency.types.js';

@injectable()
export class SyncCurrencyUseCase {
  constructor(
    @inject(TOKENS.AdminCurrencyRepository) private currencyRepo: IAdminCurrencyRepository,
  ) {}

  async execute(dto: SyncCurrencyDto): Promise<SyncCurrencyResult> {
    return this.currencyRepo.syncCurrency(dto);
  }
}
