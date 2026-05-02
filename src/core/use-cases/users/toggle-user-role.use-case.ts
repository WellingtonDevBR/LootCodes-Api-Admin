import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminUserRepository } from '../../ports/admin-user-repository.port.js';
import type { ToggleUserRoleDto, ToggleUserRoleResult } from './user.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class ToggleUserRoleUseCase {
  constructor(
    @inject(TOKENS.AdminUserRepository) private repo: IAdminUserRepository,
  ) {}

  async execute(dto: ToggleUserRoleDto): Promise<ToggleUserRoleResult> {
    if (!dto.user_id) throw new ValidationError('User ID is required');
    if (!dto.role) throw new ValidationError('Role is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.toggleUserRole(dto);
  }
}
