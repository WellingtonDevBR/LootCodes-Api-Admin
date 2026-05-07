import type {
  ManualProviderPurchaseDto,
  ManualProviderPurchaseResult,
} from '../use-cases/procurement/procurement.types.js';

/** Native orchestration for admin-triggered provider purchases (no Edge invoke). */
export interface IBuyerManualPurchasePort {
  execute(dto: ManualProviderPurchaseDto): Promise<ManualProviderPurchaseResult>;
}
