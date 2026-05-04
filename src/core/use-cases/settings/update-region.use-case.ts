import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { UpdateRegionDto, Region } from './settings.types.js';

@injectable()
export class UpdateRegionUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(id: string, dto: UpdateRegionDto): Promise<Region> {
    return this.repo.updateRegion(id, dto);
  }
}
