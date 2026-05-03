import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProductRepository } from '../../ports/admin-product-repository.port.js';
import type { CreateProductDto, CreateProductResult } from './product.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class CreateProductUseCase {
  constructor(
    @inject(TOKENS.AdminProductRepository) private repo: IAdminProductRepository,
  ) {}

  async execute(dto: CreateProductDto): Promise<CreateProductResult> {
    if (!dto.name) throw new ValidationError('Product name is required');
    if (!dto.product_type) throw new ValidationError('Product type is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.createProduct(dto);
  }
}
