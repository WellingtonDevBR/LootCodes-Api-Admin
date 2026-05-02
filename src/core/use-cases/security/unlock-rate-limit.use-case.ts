import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { UnlockRateLimitDto, UnlockRateLimitResult } from './security.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class UnlockRateLimitUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(dto: UnlockRateLimitDto): Promise<UnlockRateLimitResult> {
    if (!dto.identifier) throw new ValidationError('Identifier is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.unlockRateLimit(dto);
  }
}
