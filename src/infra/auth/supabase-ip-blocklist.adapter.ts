import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IIpBlocklist } from '../../core/ports/ip-blocklist.port.js';
import type { IDatabase } from '../../core/ports/database.port.js';

@injectable()
export class SupabaseIpBlocklistAdapter implements IIpBlocklist {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async isBlocked(ipAddress: string): Promise<boolean> {
    if (!ipAddress || ipAddress === 'unknown') return false;
    const result = await this.db.rpc<boolean>('is_ip_blocked', { p_ip_address: ipAddress });
    return result === true;
  }
}
