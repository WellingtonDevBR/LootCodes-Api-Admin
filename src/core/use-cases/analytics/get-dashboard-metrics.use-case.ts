import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAnalyticsRepository } from '../../ports/admin-analytics-repository.port.js';
import type { GetDashboardMetricsDto, GetDashboardMetricsResult } from './analytics.types.js';

@injectable()
export class GetDashboardMetricsUseCase {
  constructor(
    @inject(TOKENS.AdminAnalyticsRepository) private repo: IAdminAnalyticsRepository,
  ) {}

  async execute(dto: GetDashboardMetricsDto): Promise<GetDashboardMetricsResult> {
    return this.repo.getDashboardMetrics(dto);
  }
}
