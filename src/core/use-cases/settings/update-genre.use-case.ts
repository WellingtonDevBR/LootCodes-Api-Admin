import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { UpdateGenreDto, Genre } from './settings.types.js';

@injectable()
export class UpdateGenreUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(id: string, dto: UpdateGenreDto): Promise<Genre> {
    return this.repo.updateGenre(id, dto);
  }
}
