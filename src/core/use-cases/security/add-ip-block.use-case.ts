import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { AddIpBlockDto, AddIpBlockResult } from './security.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class AddIpBlockUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(dto: AddIpBlockDto): Promise<AddIpBlockResult> {
    if (!dto.ip_address) throw new ValidationError('IP address is required');
    if (!dto.reason) throw new ValidationError('Reason is required');
    if (!dto.severity) throw new ValidationError('Severity is required');

    const result = await this.repo.addIpBlock(dto);
    await this.repo.logAdminAction(dto.admin_id, 'add_ip_block', 'ip_blocklist', result.id, {
      ip_address: dto.ip_address,
      severity: dto.severity,
    });
    return result;
  }
}
