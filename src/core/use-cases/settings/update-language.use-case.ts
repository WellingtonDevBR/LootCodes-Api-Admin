import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { UpdateLanguageDto, Language } from './settings.types.js';

@injectable()
export class UpdateLanguageUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(id: string, dto: UpdateLanguageDto): Promise<Language> {
    return this.repo.updateLanguage(id, dto);
  }
}
