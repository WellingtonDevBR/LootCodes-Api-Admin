import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOrderRepository } from '../../ports/admin-order-repository.port.js';
import type { ListOrdersDto, ListOrdersResult } from './order.types.js';

@injectable()
export class ListOrdersUseCase {
  constructor(
    @inject(TOKENS.AdminOrderRepository) private orderRepo: IAdminOrderRepository,
  ) {}

  async execute(dto: ListOrdersDto): Promise<ListOrdersResult> {
    return this.orderRepo.listOrders(dto);
  }
}
