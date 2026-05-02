import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { ForceLogoutDto, ForceLogoutResult } from './security.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class ForceLogoutUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(dto: ForceLogoutDto): Promise<ForceLogoutResult> {
    if (!dto.user_id) throw new ValidationError('User ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.forceLogout(dto);
  }
}
