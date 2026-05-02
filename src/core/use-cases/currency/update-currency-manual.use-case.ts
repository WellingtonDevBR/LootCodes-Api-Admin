import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminCurrencyRepository } from '../../ports/admin-currency-repository.port.js';
import type { UpdateCurrencyManualDto, UpdateCurrencyManualResult } from './currency.types.js';

@injectable()
export class UpdateCurrencyManualUseCase {
  constructor(
    @inject(TOKENS.AdminCurrencyRepository) private currencyRepo: IAdminCurrencyRepository,
  ) {}

  async execute(dto: UpdateCurrencyManualDto): Promise<UpdateCurrencyManualResult> {
    return this.currencyRepo.updateCurrencyManual(dto);
  }
}
