import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { GetInventoryKpisResult } from './inventory.types.js';

@injectable()
export class GetInventoryKpisUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private readonly repo: IAdminInventoryRepository,
  ) {}

  execute(): Promise<GetInventoryKpisResult> {
    return this.repo.getInventoryKpis();
  }
}
