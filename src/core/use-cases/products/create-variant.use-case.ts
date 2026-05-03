import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProductRepository } from '../../ports/admin-product-repository.port.js';
import type { CreateVariantDto, CreateVariantResult } from './product.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class CreateVariantUseCase {
  constructor(
    @inject(TOKENS.AdminProductRepository) private repo: IAdminProductRepository,
  ) {}

  async execute(dto: CreateVariantDto): Promise<CreateVariantResult> {
    if (!dto.product_id) throw new ValidationError('Product ID is required');
    if (!dto.platform_ids?.length) throw new ValidationError('At least one platform is required');
    if (dto.price_usd == null || dto.price_usd < 0) throw new ValidationError('Valid price is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.createVariant(dto);
  }
}
