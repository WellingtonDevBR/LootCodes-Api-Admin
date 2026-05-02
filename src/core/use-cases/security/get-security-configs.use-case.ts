import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { GetSecurityConfigsResult } from './security.types.js';

@injectable()
export class GetSecurityConfigsUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(): Promise<GetSecurityConfigsResult> {
    return this.repo.getSecurityConfigs();
  }
}
