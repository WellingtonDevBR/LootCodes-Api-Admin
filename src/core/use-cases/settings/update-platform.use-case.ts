import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { UpdatePlatformDto, Platform } from './settings.types.js';

@injectable()
export class UpdatePlatformUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(id: string, dto: UpdatePlatformDto): Promise<Platform> {
    return this.repo.updatePlatform(id, dto);
  }
}
