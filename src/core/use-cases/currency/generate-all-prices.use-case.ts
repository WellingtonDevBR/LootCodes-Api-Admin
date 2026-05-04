import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminCurrencyRepository } from '../../ports/admin-currency-repository.port.js';
import type { GenerateAllPricesDto, GenerateAllPricesResult } from './currency.types.js';

@injectable()
export class GenerateAllPricesUseCase {
  constructor(
    @inject(TOKENS.AdminCurrencyRepository) private currencyRepo: IAdminCurrencyRepository,
  ) {}

  async execute(dto: GenerateAllPricesDto): Promise<GenerateAllPricesResult> {
    return this.currencyRepo.generateAllPrices(dto);
  }
}
