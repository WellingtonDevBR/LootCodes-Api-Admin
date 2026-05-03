import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProductRepository } from '../../ports/admin-product-repository.port.js';
import type { ListProductsDto, ListProductsResult } from './product.types.js';

@injectable()
export class ListProductsUseCase {
  constructor(
    @inject(TOKENS.AdminProductRepository) private repo: IAdminProductRepository,
  ) {}

  async execute(dto: ListProductsDto): Promise<ListProductsResult> {
    return this.repo.listProducts(dto);
  }
}
