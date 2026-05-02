import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { ProcessPreorderDto, ProcessPreorderResult } from './order.types.js';

@injectable()
export class ProcessPreorderUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: ProcessPreorderDto): Promise<ProcessPreorderResult> {
    return this.orderRepo.processPreorder(dto);
  }
}
