import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminAlgoliaRepository } from '../../core/ports/admin-algolia-repository.port.js';
import type { GetAlgoliaIndexStatsResult } from '../../core/use-cases/algolia/algolia.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminAlgoliaRepository');

@injectable()
export class SupabaseAdminAlgoliaRepository implements IAdminAlgoliaRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async getIndexStats(): Promise<GetAlgoliaIndexStatsResult> {
    logger.info('Fetching Algolia index stats');

    const stats = await this.db.rpc<unknown>(
      'admin_get_algolia_index_stats',
      {},
    );

    return { stats };
  }
}
