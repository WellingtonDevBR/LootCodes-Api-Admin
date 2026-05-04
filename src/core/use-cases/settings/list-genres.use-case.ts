import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { Genre } from './settings.types.js';

@injectable()
export class ListGenresUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(): Promise<Genre[]> {
    return this.repo.listGenres();
  }
}
