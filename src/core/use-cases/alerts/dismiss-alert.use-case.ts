import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAlertsRepository } from '../../ports/admin-alerts-repository.port.js';
import type { DismissAlertDto } from './alerts.types.js';

@injectable()
export class DismissAlertUseCase {
  constructor(
    @inject(TOKENS.AdminAlertsRepository) private readonly repo: IAdminAlertsRepository,
  ) {}

  async execute(dto: DismissAlertDto): Promise<void> {
    return this.repo.dismissAlert(dto);
  }
}
