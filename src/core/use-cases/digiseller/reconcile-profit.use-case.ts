/**
 * Digiseller profit reconciliation use case.
 *
 * Three modes (mutually exclusive):
 *   - transaction_id: reconcile a single transaction
 *   - invoice_id: reconcile by Digiseller invoice number
 *   - all_missing: backfill all marketplace_sale rows missing seller_profit_cents
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminDigisellerRepository } from '../../ports/admin-digiseller-repository.port.js';
import type { DigisellerReconcileProfitDto, DigisellerReconcileProfitResult } from './digiseller.types.js';

@injectable()
export class DigisellerReconcileProfitUseCase {
  constructor(
    @inject(TOKENS.AdminDigisellerRepository) private repo: IAdminDigisellerRepository,
  ) {}

  async execute(dto: DigisellerReconcileProfitDto): Promise<DigisellerReconcileProfitResult> {
    return this.repo.reconcileProfit(dto);
  }
}
