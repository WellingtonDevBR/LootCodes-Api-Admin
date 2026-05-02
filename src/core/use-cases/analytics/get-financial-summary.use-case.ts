import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAnalyticsRepository } from '../../ports/admin-analytics-repository.port.js';
import type { GetFinancialSummaryDto, GetFinancialSummaryResult } from './analytics.types.js';

@injectable()
export class GetFinancialSummaryUseCase {
  constructor(
    @inject(TOKENS.AdminAnalyticsRepository) private repo: IAdminAnalyticsRepository,
  ) {}

  async execute(dto: GetFinancialSummaryDto): Promise<GetFinancialSummaryResult> {
    return this.repo.getFinancialSummary(dto);
  }
}
