import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminVerificationRepository } from '../../ports/admin-verification-repository.port.js';
import type { DenyVerificationDto, DenyVerificationResult } from './verification.types.js';

@injectable()
export class DenyVerificationUseCase {
  constructor(
    @inject(TOKENS.AdminVerificationRepository) private repo: IAdminVerificationRepository,
  ) {}

  async execute(dto: DenyVerificationDto): Promise<DenyVerificationResult> {
    return this.repo.denyVerification(dto);
  }
}
