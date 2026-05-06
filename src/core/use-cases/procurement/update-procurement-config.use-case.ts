import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { UpdateProcurementConfigDto, ProcurementConfig } from './procurement.types.js';

@injectable()
export class UpdateProcurementConfigUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private repo: IAdminProcurementRepository,
  ) {}

  async execute(dto: UpdateProcurementConfigDto): Promise<ProcurementConfig> {
    return this.repo.updateProcurementConfig(dto);
  }
}
