import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminUserRepository } from '../../ports/admin-user-repository.port.js';
import type { GetUserTimelineDto, GetUserTimelineResult } from './user.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class GetUserTimelineUseCase {
  constructor(
    @inject(TOKENS.AdminUserRepository) private repo: IAdminUserRepository,
  ) {}

  async execute(dto: GetUserTimelineDto): Promise<GetUserTimelineResult> {
    if (!dto.user_id) throw new ValidationError('User ID is required');
    return this.repo.getUserTimeline(dto);
  }
}
