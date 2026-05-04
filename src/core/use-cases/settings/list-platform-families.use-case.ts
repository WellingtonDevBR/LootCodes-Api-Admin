import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { PlatformFamily } from './settings.types.js';

@injectable()
export class ListPlatformFamiliesUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(): Promise<PlatformFamily[]> {
    return this.repo.listPlatformFamilies();
  }
}
