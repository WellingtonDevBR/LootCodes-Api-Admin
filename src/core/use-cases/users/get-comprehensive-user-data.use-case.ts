import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminUserRepository } from '../../ports/admin-user-repository.port.js';
import type { GetComprehensiveUserDataDto, GetComprehensiveUserDataResult } from './user.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class GetComprehensiveUserDataUseCase {
  constructor(
    @inject(TOKENS.AdminUserRepository) private repo: IAdminUserRepository,
  ) {}

  async execute(dto: GetComprehensiveUserDataDto): Promise<GetComprehensiveUserDataResult> {
    if (!dto.user_id) throw new ValidationError('User ID is required');
    return this.repo.getComprehensiveUserData(dto);
  }
}
