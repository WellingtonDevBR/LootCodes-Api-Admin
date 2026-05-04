import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { ListClaimsDto, ListClaimsResult } from './price-match.types.js';

@injectable()
export class ListPriceMatchClaimsUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(dto: ListClaimsDto): Promise<ListClaimsResult> {
    return this.repo.listClaims(dto);
  }
}
