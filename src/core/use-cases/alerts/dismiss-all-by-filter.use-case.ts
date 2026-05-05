import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAlertsRepository } from '../../ports/admin-alerts-repository.port.js';
import type { DismissAllByFilterDto } from './alerts.types.js';

@injectable()
export class DismissAllByFilterUseCase {
  constructor(
    @inject(TOKENS.AdminAlertsRepository) private readonly repo: IAdminAlertsRepository,
  ) {}

  async execute(dto: DismissAllByFilterDto): Promise<number> {
    return this.repo.dismissAllByFilter(dto);
  }
}
