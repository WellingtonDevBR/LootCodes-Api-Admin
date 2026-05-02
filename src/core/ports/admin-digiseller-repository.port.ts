import type {
  DigisellerReconcileProfitDto,
  DigisellerReconcileProfitResult,
} from '../use-cases/digiseller/digiseller.types.js';

export interface IAdminDigisellerRepository {
  reconcileProfit(dto: DigisellerReconcileProfitDto): Promise<DigisellerReconcileProfitResult>;
}
