import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard, internalSecretGuard } from '../middleware/auth.guard.js';
import type { ListOrdersUseCase } from '../../core/use-cases/orders/list-orders.use-case.js';
import type { GetOrderDetailUseCase } from '../../core/use-cases/orders/get-order-detail.use-case.js';

interface OrderItemEmbed {
  product_id?: string;
  products?: { name?: string } | null;
}

function extractProductName(raw: Record<string, unknown>): string {
  const orderItems = raw.order_items as OrderItemEmbed[] | undefined;
  if (!orderItems || orderItems.length === 0) return '';
  const firstItem = orderItems[0];
  return firstItem?.products?.name ?? '';
}

function toSerializedOrder(raw: Record<string, unknown>) {
  const totalAmount = (raw.total_amount as number) ?? 0;
  const currency = (raw.currency as string) ?? 'USD';
  const money = { amount: totalAmount, currency };
  const zeroMoney = { amount: 0, currency };
  return {
    order: {
      id: raw.id as string,
      orderNumber: (raw.order_number as string) ?? null,
      channel: (raw.order_channel as string) ?? 'direct',
      status: raw.status as string,
      productName: extractProductName(raw),
      sku: (raw.order_number as string) ?? '',
      qty: 1,
      revenue: money,
      cost: zeroMoney,
      unitPrice: money,
      placedAt: raw.created_at as string,
      customer: (raw.contact_email as string) ?? (raw.delivery_email as string) ?? 'Guest',
      profit: { amount: totalAmount, currency },
    },
    presentation: {
      paidTotal: { amount: totalAmount, currency },
      paidGrossAud: null,
      paidNetAud: null,
      processorFeeAud: null,
      channelFeeAud: null,
      productCostAud: null,
      costAud: null,
      profitAud: null,
      netIsSellerProceedsAfterMkt: false,
      processorFeeLinePrefix: 'Net:' as const,
      kpiProfitUsd: { amount: totalAmount, currency },
    },
  };
}

export async function adminOrderRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as {
      limit?: string;
      offset?: string;
      status?: string;
      from?: string;
      to?: string;
    };
    const uc = container.resolve<ListOrdersUseCase>(UC_TOKENS.ListOrders);
    const limit = query.limit ? Number(query.limit) : 25;
    const offset = query.offset ? Number(query.offset) : 0;
    const result = await uc.execute({
      page: Math.floor(offset / limit) + 1,
      limit,
      status: query.status,
      search: query.from && query.to ? `${query.from}..${query.to}` : undefined,
    });

    const shaped = {
      orders: (result.orders as Record<string, unknown>[]).map(toSerializedOrder),
      total: result.total,
    };
    return reply.send(shaped);
  });

  app.get('/:orderId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const uc = container.resolve<GetOrderDetailUseCase>(UC_TOKENS.GetOrderDetail);
    const result = await uc.execute(orderId);
    return reply.send(result);
  });

  app.post('/fulfill-verified', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/manual-fulfill', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/recover', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/confirm-payment', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/refund', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/refund-initiate', { preHandler: [internalSecretGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
