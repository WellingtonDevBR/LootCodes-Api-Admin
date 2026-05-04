import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProductRepository } from '../../ports/admin-product-repository.port.js';
import type { CreateProductDto, CreateProductResult } from './product.types.js';
import { ValidationError } from '../../errors/domain-errors.js';
import {
  isValidProductType,
  isValidDeliveryType,
  isValidCategory,
  resolveCategoryFromType,
  validateVariantInputs,
} from '../../shared/product-validator.js';

@injectable()
export class CreateProductUseCase {
  constructor(
    @inject(TOKENS.AdminProductRepository) private repo: IAdminProductRepository,
  ) {}

  async execute(dto: CreateProductDto): Promise<CreateProductResult> {
    if (!dto.name?.trim()) throw new ValidationError('Product name is required');
    if (!dto.product_type) throw new ValidationError('Product type is required');
    if (!isValidProductType(dto.product_type)) {
      throw new ValidationError(`Invalid product type: ${dto.product_type}`);
    }
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');

    if (dto.delivery_type && !isValidDeliveryType(dto.delivery_type)) {
      throw new ValidationError(`Invalid delivery type: ${dto.delivery_type}. Must be one of: instant, manual, pre_order`);
    }

    if (dto.category && !isValidCategory(dto.category)) {
      throw new ValidationError(`Invalid category: ${dto.category}`);
    }

    if (!dto.category) {
      dto.category = resolveCategoryFromType(dto.product_type);
    }

    if (dto.variants?.length) {
      const variantErrors = validateVariantInputs(dto.variants);
      if (variantErrors.length > 0) {
        const msg = variantErrors.map(e => `Variant ${e.index}: ${e.error}`).join('; ');
        throw new ValidationError(`Invalid variant data: ${msg}`);
      }
    }

    return this.repo.createProduct(dto);
  }
}
