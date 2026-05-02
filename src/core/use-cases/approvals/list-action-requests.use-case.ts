import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminApprovalRepository } from '../../ports/admin-approval-repository.port.js';
import type { ListActionRequestsDto, ListActionRequestsResult } from './approval.types.js';

@injectable()
export class ListActionRequestsUseCase {
  constructor(
    @inject(TOKENS.AdminApprovalRepository) private repo: IAdminApprovalRepository,
  ) {}

  async execute(dto: ListActionRequestsDto): Promise<ListActionRequestsResult> {
    return this.repo.listActionRequests(dto);
  }
}
