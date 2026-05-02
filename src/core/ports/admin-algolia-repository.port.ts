import type { GetAlgoliaIndexStatsResult } from '../use-cases/algolia/algolia.types.js';

export interface IAdminAlgoliaRepository {
  getIndexStats(): Promise<GetAlgoliaIndexStatsResult>;
}
