import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProductRepository } from '../../ports/admin-product-repository.port.js';
import type { UpdateProductDto, UpdateProductResult } from './product.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class UpdateProductUseCase {
  constructor(
    @inject(TOKENS.AdminProductRepository) private repo: IAdminProductRepository,
  ) {}

  async execute(dto: UpdateProductDto): Promise<UpdateProductResult> {
    if (!dto.product_id) throw new ValidationError('Product ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.updateProduct(dto);
  }
}
