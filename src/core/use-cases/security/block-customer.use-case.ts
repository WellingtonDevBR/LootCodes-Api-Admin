import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { BlockCustomerDto, BlockCustomerResult } from './security.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class BlockCustomerUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(dto: BlockCustomerDto): Promise<BlockCustomerResult> {
    if (!dto.user_id && !dto.email && !dto.ip_address) {
      throw new ValidationError('At least one identifier (user_id, email, or ip_address) is required');
    }
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    if (!dto.reason) throw new ValidationError('Reason is required');
    return this.repo.blockCustomer(dto);
  }
}
