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
    const offset = (page - 1) * limit;

    // Use queryPaginated + range so PostgREST returns only the requested page
    // and the exact total count — no full-scan + in-memory slice.
    const queryOpts: import('../../core/ports/database.port.js').QueryOptions = {
      select: 'id, order_number, status, total_amount, currency, delivery_email, contact_email, guest_email, created_at, updated_at, order_channel, payment_provider, provider_fee, net_amount, marketplace_pricing, quantity, order_items(product_id, variant_id, quantity, unit_price, total_price, products(name), product_variants(face_value, sku, product_regions(name)))',
      order: { column: 'created_at', ascending: false },
      range: [offset, offset + limit - 1],
    };

    const eqFilters: Array<[string, unknown]> = [];
    if (dto.status) eqFilters.push(['status', dto.status]);
    if (eqFilters.length > 0) queryOpts.eq = eqFilters;

    if (dto.from) queryOpts.gte = [['created_at', dto.from]];
    if (dto.to) queryOpts.lte = [['created_at', dto.to]];

    const { data: sliced, total: totalCount } = await this.db.queryPaginated<Record<string, unknown>>('orders', queryOpts);

    const orderIds = sliced.map(o => o.id as string);
    const keyCostMap = new Map<string, { cost: number; currency: string }>();
    if (orderIds.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < orderIds.length; i += BATCH) {
        const chunk = orderIds.slice(i, i + BATCH);
        const keys = await this.db.query<{
          order_id: string;
          purchase_cost: string | number | null;
          purchase_currency: string | null;
        }>(
          'product_keys',
          { select: 'order_id, purchase_cost, purchase_currency', in: [['order_id', chunk]] },
        );
        for (const k of keys) {
          const cost = typeof k.purchase_cost === 'number' ? k.purchase_cost
            : typeof k.purchase_cost === 'string' ? Number(k.purchase_cost) : 0;
          const existing = keyCostMap.get(k.order_id);
          keyCostMap.set(k.order_id, {
            cost: (existing?.cost ?? 0) + cost,
            currency: k.purchase_currency ?? existing?.currency ?? 'USD',
          });
        }
      }
    }

    const enriched = sliced.map(o => {
      const keyCost = keyCostMap.get(o.id as string);
      return {
        ...o,
        key_cost_cents: keyCost?.cost ?? 0,
        key_cost_currency: keyCost?.currency ?? 'USD',
      };
    });

    return {
      orders: enriched,
      total: totalCount,
      page,
    };
  }

  async getOrderDetail(orderId: string): Promise<unknown> {
    const order = await this.db.queryOne<Record<string, unknown>>('orders', {
      select: 'id, order_number, status, total_amount, currency, delivery_email, contact_email, guest_email, customer_full_name, created_at, updated_at, order_channel, payment_provider, payment_method, provider_fee, net_amount, marketplace_pricing, quantity, ip_address, ip_country, billing_country_code, notes, admin_notes, refund_amount, refund_reason, refunded_at, discount_amount_cents, subtotal_cents, order_items(id, product_id, variant_id, quantity, unit_price, total_price, status, products(name), product_variants(face_value, sku, product_regions(name)))',
      eq: [['id', orderId]],
    });

    if (!order) return null;

    const keys = await this.db.query<Record<string, unknown>>('product_keys', {
      select: 'id, variant_id, key_state, is_used, purchase_cost, purchase_currency, used_at, created_at, supplier_reference',
      eq: [['order_id', orderId]],
    });

    const orderItems = order.order_items as Array<Record<string, unknown>> | undefined;
    const variantIds = (orderItems ?? [])
      .map(i => i.variant_id as string)
      .filter(Boolean);

    const variantPlatformMap = new Map<string, string[]>();
    if (variantIds.length > 0) {
      const vpRows = await this.db.query<{ variant_id: string; product_platforms: { name: string } }>(
        'variant_platforms',
        { select: 'variant_id, product_platforms(name)', in: [['variant_id', variantIds]] },
      );
      for (const vp of vpRows) {
        const existing = variantPlatformMap.get(vp.variant_id) ?? [];
        const name = (vp.product_platforms as unknown as { name: string })?.name;
        if (name) existing.push(name);
        variantPlatformMap.set(vp.variant_id, existing);
      }
    }

    const enrichedItems = (orderItems ?? []).map(item => ({
      ...item,
      platform_names: variantPlatformMap.get(item.variant_id as string) ?? [],
    }));

    return { ...order, order_items: enrichedItems, delivered_keys: keys };
  }
}
