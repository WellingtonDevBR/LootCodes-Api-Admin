import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProcurementRepository } from '../../ports/admin-procurement-repository.port.js';
import type { CancelQueueItemDto, CancelQueueItemResult } from './procurement.types.js';

@injectable()
export class CancelQueueItemUseCase {
  constructor(
    @inject(TOKENS.AdminProcurementRepository) private repo: IAdminProcurementRepository,
  ) {}

  async execute(dto: CancelQueueItemDto): Promise<CancelQueueItemResult> {
    return this.repo.cancelQueueItem(dto);
  }
}
