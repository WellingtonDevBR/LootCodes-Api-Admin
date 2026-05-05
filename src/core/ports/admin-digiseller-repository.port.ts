/**
 * Port for Digiseller admin operations — reconciliation and order info.
 *
 * Wraps the Digiseller `purchase/info` API and reconciliation logic.
 */
import type {
  DigisellerReconcileProfitDto,
  DigisellerReconcileProfitResult,
  DigisellerOrderInfo,
} from '../use-cases/digiseller/digiseller.types.js';

export interface IAdminDigisellerRepository {
  reconcileProfit(dto: DigisellerReconcileProfitDto): Promise<DigisellerReconcileProfitResult>;

  fetchOrderInfo(providerAccountId: string, invoiceId: string): Promise<DigisellerOrderInfo>;
}
