import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { TestProviderQuoteDto, TestProviderQuoteResult } from './procurement.types.js';

@injectable()
export class TestProviderQuoteUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: TestProviderQuoteDto): Promise<TestProviderQuoteResult> {
    return this.procurementRepo.testProviderQuote(dto);
  }
}
