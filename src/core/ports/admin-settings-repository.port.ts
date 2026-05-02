import type {
  ListSettingsDto,
  ListSettingsResult,
  UpdateSettingDto,
  UpdateSettingResult,
} from '../use-cases/settings/settings.types.js';

export interface IAdminSettingsRepository {
  listSettings(dto: ListSettingsDto): Promise<ListSettingsResult>;
  updateSetting(dto: UpdateSettingDto): Promise<UpdateSettingResult>;
}
