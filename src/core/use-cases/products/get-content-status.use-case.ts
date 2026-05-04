import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProductRepository } from '../../ports/admin-product-repository.port.js';
import type { ContentPipelineStatus, GetContentStatusDto } from './product.types.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { isValidUuid } from '../../shared/product-validator.js';

@injectable()
export class GetContentStatusUseCase {
  constructor(
    @inject(TOKENS.AdminProductRepository) private repo: IAdminProductRepository,
  ) {}

  async execute(dto: GetContentStatusDto): Promise<ContentPipelineStatus> {
    if (!dto.product_id || !isValidUuid(dto.product_id)) {
      throw new ValidationError('Valid product_id is required');
    }
    return this.repo.getContentPipelineStatus(dto);
  }
}
