import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAlgoliaRepository } from '../../ports/admin-algolia-repository.port.js';
import type { GetAlgoliaIndexStatsResult } from './algolia.types.js';

@injectable()
export class GetAlgoliaIndexStatsUseCase {
  constructor(
    @inject(TOKENS.AdminAlgoliaRepository) private repo: IAdminAlgoliaRepository,
  ) {}

  async execute(): Promise<GetAlgoliaIndexStatsResult> {
    return this.repo.getIndexStats();
  }
}
