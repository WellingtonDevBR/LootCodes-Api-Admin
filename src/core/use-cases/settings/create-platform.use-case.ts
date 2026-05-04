import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { CreatePlatformDto, Platform } from './settings.types.js';

@injectable()
export class CreatePlatformUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(dto: CreatePlatformDto): Promise<Platform> {
    return this.repo.createPlatform(dto);
  }
}
