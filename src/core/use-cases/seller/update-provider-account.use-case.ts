import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { UpdateProviderAccountDto, UpdateProviderAccountResult } from './seller.types.js';

@injectable()
export class UpdateProviderAccountUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: UpdateProviderAccountDto): Promise<UpdateProviderAccountResult> {
    return this.repo.updateProviderAccount(dto);
  }
}
