import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { GenerateGuestAccessLinkDto, GenerateGuestAccessLinkResult } from './order.types.js';

@injectable()
export class GenerateGuestAccessLinkUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: GenerateGuestAccessLinkDto): Promise<GenerateGuestAccessLinkResult> {
    return this.orderRepo.generateGuestAccessLink(dto);
  }
}
