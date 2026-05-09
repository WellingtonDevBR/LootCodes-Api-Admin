import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { ProcessPriceDropRefundsResult } from './price-match.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('process-price-drop-refunds');

@injectable()
export class ProcessPriceDropRefundsUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(): Promise<ProcessPriceDropRefundsResult> {
    logger.info('Processing price-drop refunds');
    const result = await this.repo.processPriceDropRefunds();
    logger.info('Price-drop refunds processed', { grantedCount: result.grantedCount });
    return result;
  }
}
