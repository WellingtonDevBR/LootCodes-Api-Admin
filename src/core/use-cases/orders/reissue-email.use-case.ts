import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { ReissueEmailDto, ReissueEmailResult } from './order.types.js';

@injectable()
export class ReissueEmailUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: ReissueEmailDto): Promise<ReissueEmailResult> {
    return this.orderRepo.reissueEmail(dto);
  }
}
