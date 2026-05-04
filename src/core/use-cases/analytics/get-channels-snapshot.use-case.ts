import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAnalyticsRepository } from '../../ports/admin-analytics-repository.port.js';
import type { GetChannelsSnapshotDto, GetChannelsSnapshotResult } from './analytics.types.js';

@injectable()
export class GetChannelsSnapshotUseCase {
  constructor(
    @inject(TOKENS.AdminAnalyticsRepository) private repo: IAdminAnalyticsRepository,
  ) {}

  async execute(dto: GetChannelsSnapshotDto): Promise<GetChannelsSnapshotResult> {
    return this.repo.getChannelsSnapshot(dto);
  }
}
