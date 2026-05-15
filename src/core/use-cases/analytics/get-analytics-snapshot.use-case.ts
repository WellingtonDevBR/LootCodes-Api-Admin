import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAnalyticsRepository } from '../../ports/admin-analytics-repository.port.js';
import type {
  GetAnalyticsSnapshotDto,
  GetAnalyticsSnapshotResult,
} from './analytics.types.js';

@injectable()
export class GetAnalyticsSnapshotUseCase {
  constructor(
    @inject(TOKENS.AdminAnalyticsRepository) private repo: IAdminAnalyticsRepository,
  ) {}

  execute(dto: GetAnalyticsSnapshotDto): Promise<GetAnalyticsSnapshotResult> {
    return this.repo.getAnalyticsSnapshot(dto);
  }
}
