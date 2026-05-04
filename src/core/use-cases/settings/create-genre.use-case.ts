import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { CreateGenreDto, Genre } from './settings.types.js';

@injectable()
export class CreateGenreUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(dto: CreateGenreDto): Promise<Genre> {
    return this.repo.createGenre(dto);
  }
}
