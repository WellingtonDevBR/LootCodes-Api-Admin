import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { PlatformSettingResult } from './security.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class GetPlatformSecuritySettingUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(key: string): Promise<PlatformSettingResult | null> {
    if (!key) throw new ValidationError('Setting key is required');
    return this.repo.getPlatformSetting(key);
  }
}
