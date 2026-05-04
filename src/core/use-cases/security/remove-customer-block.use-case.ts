import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { RemoveCustomerBlockResult } from './security.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class RemoveCustomerBlockUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(id: string, adminId: string): Promise<RemoveCustomerBlockResult> {
    if (!id) throw new ValidationError('Block ID is required');
    const result = await this.repo.removeCustomerBlock(id);
    await this.repo.logAdminAction(adminId, 'remove_customer_block', 'customer_blocklist', id);
    return result;
  }
}
