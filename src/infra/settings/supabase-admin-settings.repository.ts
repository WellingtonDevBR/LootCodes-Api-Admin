import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminSettingsRepository } from '../../core/ports/admin-settings-repository.port.js';
import type {
  ListSettingsDto,
  ListSettingsResult,
  UpdateSettingDto,
  UpdateSettingResult,
} from '../../core/use-cases/settings/settings.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminSettingsRepository');

@injectable()
export class SupabaseAdminSettingsRepository implements IAdminSettingsRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async listSettings(dto: ListSettingsDto): Promise<ListSettingsResult> {
    const result = await this.db.rpc<{ settings: unknown[] }>(
      'admin_list_settings',
      { p_category: dto.category ?? null },
    );

    return { settings: result.settings ?? [] };
  }

  async updateSetting(dto: UpdateSettingDto): Promise<UpdateSettingResult> {
    logger.info('Updating setting', { key: dto.key, adminId: dto.admin_id });

    await this.db.rpc('admin_update_setting', {
      p_key: dto.key,
      p_value: dto.value,
      p_admin_id: dto.admin_id,
    });

    return { success: true };
  }
}
