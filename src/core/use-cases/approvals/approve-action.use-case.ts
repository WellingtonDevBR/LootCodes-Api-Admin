import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminApprovalRepository } from '../../ports/admin-approval-repository.port.js';
import type { ApproveActionDto, ApproveActionResult } from './approval.types.js';

@injectable()
export class ApproveActionUseCase {
  constructor(
    @inject(TOKENS.AdminApprovalRepository) private repo: IAdminApprovalRepository,
  ) {}

  async execute(dto: ApproveActionDto): Promise<ApproveActionResult> {
    return this.repo.approveAction(dto);
  }
}
