import type {
  ListOpportunitiesDto,
  ListOpportunitiesResult,
} from '../use-cases/opportunities/opportunities.types.js';

export interface IAdminOpportunitiesRepository {
  listOpportunities(dto: ListOpportunitiesDto): Promise<ListOpportunitiesResult>;
}
