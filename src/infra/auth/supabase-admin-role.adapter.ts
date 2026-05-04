import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IAdminRoleChecker } from '../../core/ports/admin-role.port.js';
import type { IDatabase } from '../../core/ports/database.port.js';

@injectable()
export class SupabaseAdminRoleAdapter implements IAdminRoleChecker {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async isAdminOrEmployee(userId: string): Promise<boolean> {
    const result = await this.db.rpc<boolean>('is_admin_or_employee', { p_user_id: userId });
    return result === true;
  }

  async isAdmin(userId: string): Promise<boolean> {
    const result = await this.db.rpc<boolean>('has_role', { _user_id: userId, _role: 'admin' });
    return result === true;
  }
}
