import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminOpportunitiesRepository } from '../../ports/admin-opportunities-repository.port.js';
import type { ListOpportunitiesDto, ListOpportunitiesResult } from './opportunities.types.js';

@injectable()
export class ListOpportunitiesUseCase {
  constructor(
    @inject(TOKENS.AdminOpportunitiesRepository) private repo: IAdminOpportunitiesRepository,
  ) {}

  async execute(dto: ListOpportunitiesDto): Promise<ListOpportunitiesResult> {
    return this.repo.listOpportunities(dto);
  }
}
