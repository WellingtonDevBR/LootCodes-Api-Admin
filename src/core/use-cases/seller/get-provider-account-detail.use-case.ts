import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { GetProviderAccountDetailResult } from './seller.types.js';

@injectable()
export class GetProviderAccountDetailUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(id: string): Promise<GetProviderAccountDetailResult> {
    return this.repo.getProviderAccountDetail(id);
  }
}
