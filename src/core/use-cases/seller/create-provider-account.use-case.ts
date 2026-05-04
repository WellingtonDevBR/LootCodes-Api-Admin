import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { CreateProviderAccountDto, CreateProviderAccountResult } from './seller.types.js';

@injectable()
export class CreateProviderAccountUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: CreateProviderAccountDto): Promise<CreateProviderAccountResult> {
    return this.repo.createProviderAccount(dto);
  }
}
