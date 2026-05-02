import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminOrderRepository } from '../../core/ports/admin-order-repository.port.js';
import type {
  FulfillVerifiedOrderDto,
  FulfillVerifiedOrderResult,
  ManualFulfillDto,
  ManualFulfillResult,
  RecoverOrderDto,
  RecoverOrderResult,
  ConfirmPaymentDto,
  ConfirmPaymentResult,
  ProcessPreorderDto,
  ProcessPreorderResult,
  GenerateGuestAccessLinkDto,
  GenerateGuestAccessLinkResult,
  RefundOrderDto,
  RefundOrderResult,
  RefundTicketDto,
  RefundTicketResult,
  RefundInitiateDto,
  RefundInitiateResult,
  ReissueEmailDto,
  ReissueEmailResult,
  ListOrdersDto,
  ListOrdersResult,
} from '../../core/use-cases/orders/order.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminOrderRepository');

const DEFAULT_PAGE_LIMIT = 25;

@injectable()
export class SupabaseAdminOrderRepository implements IAdminOrderRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async fulfillVerifiedOrder(dto: FulfillVerifiedOrderDto): Promise<FulfillVerifiedOrderResult> {
    logger.info('Fulfilling verified order', { orderId: dto.order_id, userId: dto.admin_id });

    const result = await this.db.rpc<{ success: boolean; keys_delivered?: number }>(
      'admin_fulfill_verified_order',
      { p_order_id: dto.order_id, p_admin_id: dto.admin_id },
    );

    return {
      success: result.success,
      order_id: dto.order_id,
      keys_delivered: result.keys_delivered,
    };
  }

  async manualFulfill(dto: ManualFulfillDto): Promise<ManualFulfillResult> {
    logger.info('Manual fulfillment', { orderId: dto.order_id, userId: dto.admin_id });

    await this.db.rpc('manual_fulfill_order', {
      p_order_id: dto.order_id,
      p_admin_id: dto.admin_id,
      p_reason: dto.reason ?? 'Manual admin fulfillment',
    });

    return { success: true, order_id: dto.order_id };
  }

  async recoverOrder(dto: RecoverOrderDto): Promise<RecoverOrderResult> {
    logger.info('Recovering order', { orderId: dto.order_id, userId: dto.admin_id });

    const result = await this.db.rpc<{ new_status: string }>(
      'admin_recover_order',
      { p_order_id: dto.order_id, p_admin_id: dto.admin_id },
    );

    return {
      success: true,
      order_id: dto.order_id,
      new_status: result.new_status,
    };
  }

  async confirmPayment(dto: ConfirmPaymentDto): Promise<ConfirmPaymentResult> {
    logger.info('Confirming payment', { orderId: dto.order_id, userId: dto.admin_id });

    await this.db.rpc('admin_confirm_payment', {
      p_order_id: dto.order_id,
      p_admin_id: dto.admin_id,
    });

    return { success: true, order_id: dto.order_id };
  }

  async processPreorder(dto: ProcessPreorderDto): Promise<ProcessPreorderResult> {
    logger.info('Processing preorder', { orderId: dto.order_id, userId: dto.admin_id });

    await this.db.rpc('admin_process_preorder', {
      p_order_id: dto.order_id,
      p_admin_id: dto.admin_id,
    });

    return { success: true };
  }

  async generateGuestAccessLink(dto: GenerateGuestAccessLinkDto): Promise<GenerateGuestAccessLinkResult> {
    logger.info('Generating guest access link', { orderId: dto.order_id, userId: dto.admin_id });

    const result = await this.db.rpc<{ link: string; token: string; expires_at: string }>(
      'generate_guest_access_link',
      { p_order_id: dto.order_id, p_admin_id: dto.admin_id },
    );

    return {
      link: result.link,
      token: result.token,
      expires_at: result.expires_at,
    };
  }

  async refundOrder(dto: RefundOrderDto): Promise<RefundOrderResult> {
    logger.info('Refunding order', { orderId: dto.order_id, userId: dto.admin_id });

    const result = await this.db.rpc<{ refund_id?: string; amount_refunded_cents: number }>(
      'admin_refund_order',
      {
        p_order_id: dto.order_id,
        p_admin_id: dto.admin_id,
        p_reason: dto.reason,
        p_amount_cents: dto.amount_cents,
      },
    );

    return {
      success: true,
      refund_id: result.refund_id,
      amount_refunded_cents: result.amount_refunded_cents,
    };
  }

  async refundTicket(dto: RefundTicketDto): Promise<RefundTicketResult> {
    logger.info('Refunding ticket', { orderId: dto.ticket_id, userId: dto.admin_id });

    const result = await this.db.rpc<{ refund_id?: string }>(
      'admin_refund_ticket',
      {
        p_ticket_id: dto.ticket_id,
        p_admin_id: dto.admin_id,
        p_reason: dto.reason,
      },
    );

    return {
      success: true,
      refund_id: result.refund_id,
    };
  }

  async refundInitiate(dto: RefundInitiateDto): Promise<RefundInitiateResult> {
    logger.info('Initiating refund', { orderId: dto.order_id });

    const result = await this.db.rpc<{ refund_id?: string }>(
      'admin_refund_initiate',
      {
        p_order_id: dto.order_id,
        p_amount_cents: dto.amount_cents,
        p_reason: dto.reason,
      },
    );

    return {
      success: true,
      refund_id: result.refund_id,
    };
  }

  async reissueEmail(dto: ReissueEmailDto): Promise<ReissueEmailResult> {
    logger.info('Reissuing email', { orderId: dto.order_id, action: dto.email_type });

    await this.db.rpc('admin_reissue_email', {
      p_order_id: dto.order_id,
      p_admin_id: dto.admin_id,
      p_email_type: dto.email_type,
    });

    return { success: true };
  }

  async listOrders(dto: ListOrdersDto): Promise<ListOrdersResult> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? DEFAULT_PAGE_LIMIT;

    const result = await this.db.rpc<{ orders: unknown[]; total: number }>(
      'admin_list_orders',
      {
        p_page: page,
        p_limit: limit,
        p_status: dto.status ?? null,
        p_search: dto.search ?? null,
      },
    );

    return {
      orders: result.orders ?? [],
      total: result.total ?? 0,
      page,
    };
  }

  async getOrderDetail(orderId: string): Promise<unknown> {
    return this.db.rpc('get_order_summary', { p_order_id: orderId });
  }
}
