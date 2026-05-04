import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { GetWebhookStatusResult } from './seller.types.js';

@injectable()
export class GetWebhookStatusUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(accountId: string): Promise<GetWebhookStatusResult> {
    return this.repo.getWebhookStatus(accountId);
  }
}
