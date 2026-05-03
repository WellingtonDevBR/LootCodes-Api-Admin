import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminProductRepository } from '../../ports/admin-product-repository.port.js';
import type { UpdateVariantDto, UpdateVariantResult } from './product.types.js';
import { ValidationError } from '../../errors/domain-errors.js';

@injectable()
export class UpdateVariantUseCase {
  constructor(
    @inject(TOKENS.AdminProductRepository) private repo: IAdminProductRepository,
  ) {}

  async execute(dto: UpdateVariantDto): Promise<UpdateVariantResult> {
    if (!dto.variant_id) throw new ValidationError('Variant ID is required');
    if (!dto.admin_id) throw new ValidationError('Admin ID is required');
    return this.repo.updateVariant(dto);
  }
}
