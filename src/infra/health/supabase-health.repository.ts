import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IHealthRepository } from '../../core/ports/health-repository.port.js';

@injectable()
export class SupabaseHealthRepository implements IHealthRepository {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async pingReadiness(): Promise<void> {
    // `platform_settings` is always present in any deployable database, lives
    // outside the hot path, and is keyed by primary key — a `LIMIT 1` over it
    // is cheap. Any error here propagates and the route maps it to 503.
    await this.db.queryOne('platform_settings', {
      select: 'key',
      limit: 1,
    });
  }
}
