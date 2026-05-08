/**
 * DtuRechargeUseCase
 *
 * Runs DTU (Direct Top-Up) flows through any DTU-capable buyer-provider.
 * Two operations:
 *   - `executeCheck` — read-only validation; returns price + canRecharge.
 *   - `execute` — places the recharge order, logs to `provider_purchase_attempts`.
 *
 * DTU orders DO NOT return product keys; the use case never ingests anything
 * into `product_keys`. The `provider_purchase_attempts` row is the canonical
 * audit trail, with `response_snapshot.procurement_trigger = 'dtu_recharge'`.
 *
 * NOT YET wired to a Fastify route — registered in DI for in-process callers
 * and tests only.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type {
  DtuCheckResult,
  DtuOrderLineInput,
  DtuPlaceOrderResult,
  IDtuClientFactory,
} from '../../ports/dtu-client.port.js';
import type { IDatabase } from '../../ports/database.port.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('dtu-recharge');

export interface DtuRechargeInput {
  readonly providerAccountId: string;
  readonly referenceId: string;
  readonly orders: readonly DtuOrderLineInput[];
  readonly adminUserId?: string | null;
  /** When true, only validates (no order placed, no attempt logged). */
  readonly checkOnly?: boolean;
}

export type DtuRechargeOutput =
  | { readonly mode: 'check'; readonly check: DtuCheckResult }
  | {
      readonly mode: 'execute';
      readonly order: DtuPlaceOrderResult;
      readonly attemptId: string;
    };

@injectable()
export class DtuRechargeUseCase {
  constructor(
    @inject(TOKENS.DtuClientFactory) private readonly factory: IDtuClientFactory,
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async execute(input: DtuRechargeInput): Promise<DtuRechargeOutput> {
    if (!input.providerAccountId?.trim()) {
      throw new Error('providerAccountId is required');
    }
    if (!Array.isArray(input.orders) || input.orders.length === 0) {
      throw new Error('orders[] must be non-empty');
    }

    const client = await this.factory.resolve(input.providerAccountId);
    if (!client) {
      throw new Error(
        `No DTU-capable client for provider_account_id=${input.providerAccountId}`,
      );
    }

    if (input.checkOnly === true) {
      const check = await client.check({ orders: input.orders });
      logger.info('DTU check completed', {
        providerCode: client.providerCode,
        canRecharge: check.canRecharge,
      });
      return { mode: 'check', check };
    }

    if (!input.referenceId?.trim()) {
      throw new Error('referenceId is required for non-check DTU recharges');
    }

    const inserted = await this.db.insert<{ id: string }>('provider_purchase_attempts', {
      provider_account_id: input.providerAccountId,
      attempt_no: 1,
      provider_request_id: input.referenceId,
      status: 'pending',
      manual_admin_user_id: input.adminUserId ?? null,
    });

    let order: DtuPlaceOrderResult;
    try {
      order = await client.placeOrder({
        referenceId: input.referenceId,
        orders: input.orders,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db.update(
        'provider_purchase_attempts',
        { id: inserted.id },
        {
          status: 'failed',
          error_code: 'DTU_PLACE_FAILED',
          error_message: message,
          finished_at: new Date().toISOString(),
        },
      );
      logger.error('DTU place order failed', err as Error, {
        providerAccountId: input.providerAccountId,
        referenceId: input.referenceId,
      });
      throw err;
    }

    await this.db.update(
      'provider_purchase_attempts',
      { id: inserted.id },
      {
        status: order.status?.toUpperCase?.() === 'SUCCESS' ? 'success' : 'pending',
        provider_order_ref: order.orderId,
        response_snapshot: {
          procurement_trigger: 'dtu_recharge',
          status: order.status,
          price: order.price,
          currency: order.currency,
          attributes: order.attributes ?? null,
        },
        finished_at: new Date().toISOString(),
      },
    );

    return { mode: 'execute', order, attemptId: inserted.id };
  }
}
