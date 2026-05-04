import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProductRepository } from '../../ports/admin-product-repository.port.js';
import type { RegenerateContentDto, RegenerateContentResult } from './product.types.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { isValidUuid } from '../../shared/product-validator.js';

const VALID_TARGETS = ['description', 'translations', 'platform_content', 'media', 'all'] as const;

@injectable()
export class RegenerateContentUseCase {
  constructor(
    @inject(TOKENS.AdminProductRepository) private repo: IAdminProductRepository,
  ) {}

  async execute(dto: RegenerateContentDto): Promise<RegenerateContentResult> {
    if (!dto.product_id || !isValidUuid(dto.product_id)) {
      throw new ValidationError('Valid product_id is required');
    }
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    if (!(VALID_TARGETS as readonly string[]).includes(dto.target)) {
      throw new ValidationError(`Invalid target: ${dto.target}. Must be one of: ${VALID_TARGETS.join(', ')}`);
    }
    return this.repo.regenerateContent(dto);
  }
}
