import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { Platform } from './settings.types.js';

@injectable()
export class ListPlatformsUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(): Promise<Platform[]> {
    return this.repo.listPlatforms();
  }
}
