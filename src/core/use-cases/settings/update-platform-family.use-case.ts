import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { UpdatePlatformFamilyDto, PlatformFamily } from './settings.types.js';

@injectable()
export class UpdatePlatformFamilyUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(id: string, dto: UpdatePlatformFamilyDto): Promise<PlatformFamily> {
    return this.repo.updatePlatformFamily(id, dto);
  }
}
