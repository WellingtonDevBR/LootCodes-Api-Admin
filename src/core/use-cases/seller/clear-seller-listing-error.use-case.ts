import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';

/**
 * Clears a seller listing's `error_message` after an operator has reviewed and
 * resolved the underlying marketplace failure (e.g. publish 4xx, declared-stock
 * rejection). Pure write — no marketplace round-trip. The CRM "Clear error"
 * button is the only legitimate caller.
 */
@injectable()
export class ClearSellerListingErrorUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private readonly repo: IAdminSellerRepository,
  ) {}

  async execute(listingId: string): Promise<void> {
    if (!listingId) throw new Error('listing_id is required');
    await this.repo.clearSellerListingError(listingId);
  }
}
