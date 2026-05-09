import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminReferralRepository } from '../../ports/admin-referral-repository.port.js';
import type { SettlePendingBatchResult } from './referral.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('settle-pending-referrals');

const DEFAULT_BATCH_SIZE = 200;

export interface SettlePendingReferralsInput {
  batchSize?: number;
}

@injectable()
export class SettlePendingReferralsUseCase {
  constructor(
    @inject(TOKENS.AdminReferralRepository) private repo: IAdminReferralRepository,
  ) {}

  async execute(input: SettlePendingReferralsInput = {}): Promise<SettlePendingBatchResult> {
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    logger.info('Settling pending referrals', { batchSize });
    const result = await this.repo.settlePendingBatch(batchSize);
    logger.info('Pending referrals settled', {
      attempted: result.attempted,
      settled: result.settled,
      stillPending: result.stillPending,
      errors: result.errors,
    });
    return result;
  }
}
