import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminVerificationRepository } from '../../ports/admin-verification-repository.port.js';
import type { ApproveVerificationDto, ApproveVerificationResult } from './verification.types.js';

@injectable()
export class ApproveVerificationUseCase {
  constructor(
    @inject(TOKENS.AdminVerificationRepository) private repo: IAdminVerificationRepository,
  ) {}

  async execute(dto: ApproveVerificationDto): Promise<ApproveVerificationResult> {
    return this.repo.approveVerification(dto);
  }
}
