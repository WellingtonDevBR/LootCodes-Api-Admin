import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { CreateCountryDto, Country } from './settings.types.js';

@injectable()
export class CreateCountryUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(dto: CreateCountryDto): Promise<Country> {
    return this.repo.createCountry(dto);
  }
}
