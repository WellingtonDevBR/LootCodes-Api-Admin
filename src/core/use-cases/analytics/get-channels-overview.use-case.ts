import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAnalyticsRepository } from '../../ports/admin-analytics-repository.port.js';
import type { GetChannelsOverviewResult } from './analytics.types.js';

@injectable()
export class GetChannelsOverviewUseCase {
  constructor(
    @inject(TOKENS.AdminAnalyticsRepository) private repo: IAdminAnalyticsRepository,
  ) {}

  execute(): Promise<GetChannelsOverviewResult> {
    return this.repo.getChannelsOverview();
  }
}
