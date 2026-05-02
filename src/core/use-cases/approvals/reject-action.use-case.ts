import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminApprovalRepository } from '../../ports/admin-approval-repository.port.js';
import type { RejectActionDto, RejectActionResult } from './approval.types.js';

@injectable()
export class RejectActionUseCase {
  constructor(
    @inject(TOKENS.AdminApprovalRepository) private repo: IAdminApprovalRepository,
  ) {}

  async execute(dto: RejectActionDto): Promise<RejectActionResult> {
    return this.repo.rejectAction(dto);
  }
}
