import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { ManualProviderPurchaseDto, ManualProviderPurchaseResult } from './procurement.types.js';
import type { IBuyerManualPurchasePort } from '../../ports/buyer-manual-purchase.port.js';

@injectable()
export class ManualProviderPurchaseUseCase {
  constructor(
    @inject(TOKENS.BuyerManualPurchaseService) private readonly buyerManualPurchase: IBuyerManualPurchasePort,
  ) {}

  async execute(dto: ManualProviderPurchaseDto): Promise<ManualProviderPurchaseResult> {
    return this.buyerManualPurchase.execute(dto);
  }
}
