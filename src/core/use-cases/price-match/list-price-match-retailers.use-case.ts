import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { TrustedRetailerRow } from './price-match.types.js';

@injectable()
export class ListPriceMatchRetailersUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(): Promise<TrustedRetailerRow[]> {
    return this.repo.listRetailers();
  }
}
