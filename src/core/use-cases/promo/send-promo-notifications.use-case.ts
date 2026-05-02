import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPromoRepository } from '../../ports/admin-promo-repository.port.js';
import type { SendPromoNotificationsDto, SendPromoNotificationsResult } from './promo.types.js';

@injectable()
export class SendPromoNotificationsUseCase {
  constructor(
    @inject(TOKENS.AdminPromoRepository) private promoRepo: IAdminPromoRepository,
  ) {}

  async execute(dto: SendPromoNotificationsDto): Promise<SendPromoNotificationsResult> {
    return this.promoRepo.sendPromoNotifications(dto);
  }
}
