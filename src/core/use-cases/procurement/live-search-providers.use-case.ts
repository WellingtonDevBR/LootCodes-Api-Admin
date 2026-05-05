import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { LiveSearchProvidersDto, LiveSearchProvidersResult } from './procurement.types.js';

@injectable()
export class LiveSearchProvidersUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private procurementRepo: IAdminProcurementRepository,
  ) {}

  async execute(dto: LiveSearchProvidersDto): Promise<LiveSearchProvidersResult> {
    return this.procurementRepo.liveSearchProviders(dto);
  }
}
