import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { UpdateCountryDto, Country } from './settings.types.js';

@injectable()
export class UpdateCountryUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(id: string, dto: UpdateCountryDto): Promise<Country> {
    return this.repo.updateCountry(id, dto);
  }
}
