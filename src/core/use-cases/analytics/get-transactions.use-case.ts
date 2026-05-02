import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAnalyticsRepository } from '../../ports/admin-analytics-repository.port.js';
import type { GetTransactionsDto, GetTransactionsResult } from './analytics.types.js';

@injectable()
export class GetTransactionsUseCase {
  constructor(
    @inject(TOKENS.AdminAnalyticsRepository) private repo: IAdminAnalyticsRepository,
  ) {}

  async execute(dto: GetTransactionsDto): Promise<GetTransactionsResult> {
    return this.repo.getTransactions(dto);
  }
}
