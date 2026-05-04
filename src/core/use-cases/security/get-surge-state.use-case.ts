import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSecurityRepository } from '../../ports/admin-security-repository.port.js';
import type { SurgeStateResult } from './security.types.js';

@injectable()
export class GetSurgeStateUseCase {
  constructor(
    @inject(TOKENS.AdminSecurityRepository) private repo: IAdminSecurityRepository,
  ) {}

  async execute(): Promise<SurgeStateResult> {
    return this.repo.getSurgeState();
  }
}
