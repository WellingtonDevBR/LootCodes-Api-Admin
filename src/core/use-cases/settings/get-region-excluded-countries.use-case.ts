import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { ExcludedCountry } from './settings.types.js';

@injectable()
export class GetRegionExcludedCountriesUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(regionId: string): Promise<ExcludedCountry[]> {
    return this.repo.getRegionExcludedCountries(regionId);
  }
}
