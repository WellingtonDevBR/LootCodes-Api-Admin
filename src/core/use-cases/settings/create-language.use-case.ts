import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { CreateLanguageDto, Language } from './settings.types.js';

@injectable()
export class CreateLanguageUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(dto: CreateLanguageDto): Promise<Language> {
    return this.repo.createLanguage(dto);
  }
}
