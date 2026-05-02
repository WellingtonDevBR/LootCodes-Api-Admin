import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminUserRepository } from '../../ports/admin-user-repository.port.js';
import type { SearchAccountProfilesDto, SearchAccountProfilesResult } from './user.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class SearchAccountProfilesUseCase {
  constructor(
    @inject(TOKENS.AdminUserRepository) private repo: IAdminUserRepository,
  ) {}

  async execute(dto: SearchAccountProfilesDto): Promise<SearchAccountProfilesResult> {
    if (!dto.query) throw new ValidationError('Search query is required');
    return this.repo.searchAccountProfiles(dto);
  }
}
