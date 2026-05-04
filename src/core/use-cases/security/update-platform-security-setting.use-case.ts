import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { UpdatePlatformSettingDto, UpdatePlatformSettingResult } from './security.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

const ALLOWED_SECURITY_KEYS = new Set([
  'risk_assessment_settings',
  'risk_display_thresholds',
  'fulfillment_mode',
  'global_surge_config',
  'country_order_baselines',
]);

@injectable()
export class UpdatePlatformSecuritySettingUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(dto: UpdatePlatformSettingDto): Promise<UpdatePlatformSettingResult> {
    if (!dto.key) throw new ValidationError('Setting key is required');
    if (!ALLOWED_SECURITY_KEYS.has(dto.key)) {
      throw new ValidationError(`Key "${dto.key}" is not a valid security setting`);
    }

    const result = await this.repo.updatePlatformSetting(dto);
    await this.repo.logAdminAction(dto.admin_id, 'update_platform_setting', 'platform_settings', dto.key, {
      key: dto.key,
    });
    return result;
  }
}
