import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminDigisellerRepository } from '../../core/ports/admin-digiseller-repository.port.js';
import type {
  DigisellerReconcileProfitDto,
  DigisellerReconcileProfitResult,
} from '../../core/use-cases/digiseller/digiseller.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminDigisellerRepository');

@injectable()
export class SupabaseAdminDigisellerRepository implements IAdminDigisellerRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async reconcileProfit(dto: DigisellerReconcileProfitDto): Promise<DigisellerReconcileProfitResult> {
    logger.info('Reconciling Digiseller profit', { orderId: dto.order_id, adminId: dto.admin_id });

    const result = await this.db.rpc<{ orders_reconciled: number; total_profit_cents: number }>(
      'admin_digiseller_reconcile_profit',
      {
        p_order_id: dto.order_id ?? null,
        p_date_from: dto.date_range?.from ?? null,
        p_date_to: dto.date_range?.to ?? null,
        p_admin_id: dto.admin_id,
      },
    );

    return {
      success: true,
      orders_reconciled: result.orders_reconciled,
      total_profit_cents: result.total_profit_cents,
    };
  }
}
