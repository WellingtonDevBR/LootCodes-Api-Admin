import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminUserRepository } from '../../ports/admin-user-repository.port.js';
import type { DeleteUserAccountDto, DeleteUserAccountResult } from './user.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class DeleteUserAccountUseCase {
  constructor(
    @inject(TOKENS.AdminUserRepository) private repo: IAdminUserRepository,
  ) {}

  async execute(dto: DeleteUserAccountDto): Promise<DeleteUserAccountResult> {
    if (!dto.user_id) throw new ValidationError('User ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    if (!dto.reason) throw new ValidationError('Reason is required');
    return this.repo.deleteUserAccount(dto);
  }
}
