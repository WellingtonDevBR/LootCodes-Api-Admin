import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminUserRepository } from '../../ports/admin-user-repository.port.js';
import type { ListCustomersDto, ListCustomersResult } from './user.types.js';

@injectable()
export class ListCustomersUseCase {
  constructor(
    @inject(TOKENS.AdminUserRepository) private userRepo: IAdminUserRepository,
  ) {}

  async execute(dto: ListCustomersDto): Promise<ListCustomersResult> {
    return this.userRepo.listCustomers(dto);
  }
}
