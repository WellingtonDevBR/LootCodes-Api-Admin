import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProductRepository } from '../../ports/admin-product-repository.port.js';
import type { GetProductDto, GetProductResult } from './product.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class GetProductUseCase {
  constructor(
    @inject(TOKENS.AdminProductRepository) private repo: IAdminProductRepository,
  ) {}

  async execute(dto: GetProductDto): Promise<GetProductResult> {
    if (!dto.product_id) throw new ValidationError('Product ID is required');
    return this.repo.getProduct(dto);
  }
}
