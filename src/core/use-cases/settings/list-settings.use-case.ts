import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSettingsRepository } from '../../ports/admin-settings-repository.port.js';
import type { ListSettingsDto, ListSettingsResult } from './settings.types.js';

@injectable()
export class ListSettingsUseCase {
  constructor(
    @inject(TOKENS.AdminSettingsRepository) private repo: IAdminSettingsRepository,
  ) {}

  async execute(dto: ListSettingsDto): Promise<ListSettingsResult> {
    return this.repo.listSettings(dto);
  }
}
