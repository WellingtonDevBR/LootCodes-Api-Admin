import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAlertsRepository } from '../../ports/admin-alerts-repository.port.js';
import type { DismissAllAlertsDto } from './alerts.types.js';

@injectable()
export class DismissAllAlertsUseCase {
  constructor(
    @inject(TOKENS.AdminAlertsRepository) private readonly repo: IAdminAlertsRepository,
  ) {}

  async execute(dto: DismissAllAlertsDto): Promise<void> {
    return this.repo.dismissAllAlerts(dto);
  }
}
