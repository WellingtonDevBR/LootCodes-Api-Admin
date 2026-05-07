import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProductRepository } from '../../ports/admin-product-repository.port.js';
import type { CreateVariantDto, CreateVariantResult } from './product.types.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { isValidUuid, parseOptionalRetailPriceUsd, parseOptionalUuid } from '../../shared/product-validator.js';

@injectable()
export class CreateVariantUseCase {
  constructor(
    @inject(TOKENS.AdminProductRepository) private repo: IAdminProductRepository,
  ) {}

  async execute(dto: CreateVariantDto): Promise<CreateVariantResult> {
    if (!dto.product_id) throw new ValidationError('Product ID is required');
    if (!dto.platform_ids?.length) throw new ValidationError('At least one platform is required');
    if (dto.platform_ids.some((pid) => !isValidUuid(pid))) {
      throw new ValidationError('Each platform_id must be a valid UUID');
    }
    if (dto.price_usd == null || dto.price_usd < 0) throw new ValidationError('Valid price is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');

    const regionId = parseOptionalUuid(dto.region_id);
    if (!regionId) {
      throw new ValidationError('region_id is required — select a region for this variant');
    }

    const retailPriceUsd = parseOptionalRetailPriceUsd(dto.retail_price_usd);

    return this.repo.createVariant({
      ...dto,
      region_id: regionId,
      retail_price_usd: retailPriceUsd,
    });
  }
}
