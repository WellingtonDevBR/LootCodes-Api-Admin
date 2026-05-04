import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAlertsRepository } from '../../ports/admin-alerts-repository.port.js';
import type { ListAlertsDto, ListAlertsResult } from './alerts.types.js';

@injectable()
export class ListAlertsUseCase {
  constructor(
    @inject(TOKENS.AdminAlertsRepository) private readonly repo: IAdminAlertsRepository,
  ) {}

  async execute(dto: ListAlertsDto): Promise<ListAlertsResult> {
    return this.repo.listAlerts(dto);
  }
}
