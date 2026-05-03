import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { ListProviderAccountsResult } from './seller.types.js';

@injectable()
export class ListProviderAccountsUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(): Promise<ListProviderAccountsResult> {
    return this.repo.listProviderAccounts();
  }
}
