import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { RemoveIpBlockResult } from './security.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class RemoveIpBlockUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(id: string, adminId: string): Promise<RemoveIpBlockResult> {
    if (!id) throw new ValidationError('Block ID is required');
    const result = await this.repo.removeIpBlock(id);
    await this.repo.logAdminAction(adminId, 'remove_ip_block', 'ip_blocklist', id);
    return result;
  }
}
