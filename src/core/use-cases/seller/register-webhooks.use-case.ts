import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { RegisterWebhooksResult } from './seller.types.js';

@injectable()
export class RegisterWebhooksUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(accountId: string): Promise<RegisterWebhooksResult> {
    return this.repo.registerWebhooks(accountId);
  }
}
