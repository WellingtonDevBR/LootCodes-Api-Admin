import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminApprovalRepository } from '../../ports/admin-approval-repository.port.js';
import type { RequestActionDto, RequestActionResult } from './approval.types.js';

@injectable()
export class RequestActionUseCase {
  constructor(
    @inject(TOKENS.AdminApprovalRepository) private repo: IAdminApprovalRepository,
  ) {}

  async execute(dto: RequestActionDto): Promise<RequestActionResult> {
    return this.repo.requestAction(dto);
  }
}
