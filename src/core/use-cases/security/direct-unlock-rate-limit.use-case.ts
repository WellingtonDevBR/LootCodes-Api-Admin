import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { DirectUnlockRateLimitDto, DirectUnlockRateLimitResult } from './security.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class DirectUnlockRateLimitUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(dto: DirectUnlockRateLimitDto): Promise<DirectUnlockRateLimitResult> {
    if (!dto.identifier) throw new ValidationError('Identifier is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');

    const result = await this.repo.directUnlockRateLimit(dto);
    await this.repo.logAdminAction(dto.admin_id, 'direct_unlock_rate_limit', 'rate_limits', dto.identifier);
    return result;
  }
}
