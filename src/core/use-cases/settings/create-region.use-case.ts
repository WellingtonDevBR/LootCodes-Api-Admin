import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { CreateRegionDto, Region } from './settings.types.js';

@injectable()
export class CreateRegionUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(dto: CreateRegionDto): Promise<Region> {
    return this.repo.createRegion(dto);
  }
}
