export interface ListSettingsDto { category?: string }
export interface ListSettingsResult { settings: unknown[] }
export interface UpdateSettingDto { key: string; value: unknown; admin_id: string }
export interface UpdateSettingResult { success: boolean }
