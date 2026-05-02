import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { UpdateSecurityConfigDto, UpdateSecurityConfigResult } from './security.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class UpdateSecurityConfigUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(dto: UpdateSecurityConfigDto): Promise<UpdateSecurityConfigResult> {
    if (!dto.key) throw new ValidationError('Config key is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.updateSecurityConfig(dto);
  }
}
