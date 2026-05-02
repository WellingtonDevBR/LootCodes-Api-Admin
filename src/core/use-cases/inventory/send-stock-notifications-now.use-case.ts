import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { SendStockNotificationsNowDto, SendStockNotificationsNowResult } from './inventory.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class SendStockNotificationsNowUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
  ) {}

  async execute(dto: SendStockNotificationsNowDto): Promise<SendStockNotificationsNowResult> {
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.sendStockNotificationsNow(dto);
  }
}
