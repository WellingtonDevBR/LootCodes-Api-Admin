import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { ExpirePriceMatchClaimsResult } from './price-match.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('expire-price-match-claims');

@injectable()
export class ExpirePriceMatchClaimsUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(): Promise<ExpirePriceMatchClaimsResult> {
    logger.info('Expiring stale price-match claims');
    const result = await this.repo.expireStaleClaims();
    logger.info('Expired stale price-match claims', { expiredCount: result.expiredCount });
    return result;
  }
}
