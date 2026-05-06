import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { GetProcurementConfigResult } from './procurement.types.js';

@injectable()
export class GetProcurementConfigUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private repo: IAdminProcurementRepository,
  ) {}

  async execute(): Promise<GetProcurementConfigResult> {
    return this.repo.getProcurementConfig();
  }
}
