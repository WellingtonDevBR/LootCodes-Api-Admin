import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard, internalSecretGuard } from '../middleware/auth.guard.js';
import type { ListOrdersUseCase } from '../../core/use-cases/orders/list-orders.use-case.js';
import type { GetOrderDetailUseCase } from '../../core/use-cases/orders/get-order-detail.use-case.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import { type RateMap, loadCurrencyRates, convertCents } from './_currency-helpers.js';

interface OrderItemEmbed {
  product_id?: string;
  variant_id?: string;
  quantity?: number;
  unit_price?: number;
  total_price?: number;
  products?: { name?: string } | null;
  platform_names?: string[];
  product_variants?: {
    face_value?: string;
    sku?: string;
    product_regions?: { name?: string } | { name?: string }[] | null;
  } | null;
}

interface MarketplacePricing {
  provider?: string;
  provider_code?: string;
  [key: string]: unknown;
}

const DB_TO_CRM_STATUS: Record<string, string> = {
  fulfilled: 'delivered',
  pending_payment: 'pending',
  processing: 'pending',
  payment_failed: 'failed',
};

const PROVIDER_TO_CHANNEL: Record<string, string> = {
  eneba: 'Eneba',
  g2a: 'G2A',
  gamivo: 'Gamivo',
  kinguin: 'Kinguin',
  digiseller: 'Digiseller',
  stripe: 'Website',
  web: 'Website',
};

function mapStatus(dbStatus: string): string {
  return DB_TO_CRM_STATUS[dbStatus] ?? dbStatus;
}

function resolveChannel(raw: Record<string, unknown>): string {
  const mp = raw.marketplace_pricing as MarketplacePricing | null;
  const provider = mp?.provider ?? mp?.provider_code ?? null;
  if (provider) {
    const mapped = PROVIDER_TO_CHANNEL[provider.toLowerCase()];
    if (mapped) return mapped;
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
  const paymentProvider = (raw.payment_provider as string) ?? '';
  if (paymentProvider) {
    const mapped = PROVIDER_TO_CHANNEL[paymentProvider.toLowerCase()];
    if (mapped) return mapped;
  }
  const orderChannel = (raw.order_channel as string) ?? '';
  if (orderChannel === 'web' || orderChannel === 'direct') return 'Website';
  if (orderChannel === 'manual') return 'Website';
  return orderChannel || 'Website';
}

function extractProductName(raw: Record<string, unknown>): string {
  const orderItems = raw.order_items as OrderItemEmbed[] | undefined;
  if (!orderItems || orderItems.length === 0) return '';
  const firstItem = orderItems[0];
  return firstItem?.products?.name ?? '';
}

function extractVariantSku(raw: Record<string, unknown>): string {
  const orderItems = raw.order_items as OrderItemEmbed[] | undefined;
  if (!orderItems || orderItems.length === 0) return '';
  const firstItem = orderItems[0];
  return firstItem?.product_variants?.sku ?? '';
}

function serializeOrderItems(raw: Record<string, unknown>): unknown[] {
  const orderItems = raw.order_items as OrderItemEmbed[] | undefined;
  if (!orderItems || orderItems.length === 0) return [];
  return orderItems.map(item => {
    const variant = item.product_variants;
    const regions = variant?.product_regions;
    const regionName = Array.isArray(regions)
      ? (regions[0]?.name ?? null)
      : (regions as { name?: string } | null)?.name ?? null;
    return {
      productId: item.product_id ?? null,
      variantId: item.variant_id ?? null,
      productName: item.products?.name ?? '',
      faceValue: variant?.face_value ?? null,
      platforms: item.platform_names ?? [],
      region: regionName,
      quantity: item.quantity ?? 1,
      unitPrice: item.unit_price ?? 0,
      totalPrice: item.total_price ?? 0,
    };
  });
}

function computeKeyCost(raw: Record<string, unknown>): number {
  if (typeof raw.key_cost_cents === 'number') return raw.key_cost_cents;
  const keys = (raw.delivered_keys as Array<Record<string, unknown>>) ?? [];
  let total = 0;
  for (const k of keys) {
    const pc = k.purchase_cost;
    total += typeof pc === 'number' ? pc : typeof pc === 'string' ? Number(pc) : 0;
  }
  return total;
}

function resolveKeyCostCurrency(raw: Record<string, unknown>): string {
  if (typeof raw.key_cost_currency === 'string') return raw.key_cost_currency;
  const keys = (raw.delivered_keys as Array<Record<string, unknown>>) ?? [];
  for (const k of keys) {
    if (typeof k.purchase_currency === 'string') return k.purchase_currency;
  }
  return 'USD';
}

// loadCurrencyRates and convertCents are imported from ./_currency-helpers.js

const DISPLAY_CURRENCY = 'AUD';

function toSerializedOrder(raw: Record<string, unknown>, rates: RateMap) {
  const totalAmount = (raw.total_amount as number) ?? 0;
  const currency = (raw.currency as string) ?? 'USD';
  const providerFee = (raw.provider_fee as number) ?? 0;
  const netAmount = (raw.net_amount as number) ?? totalAmount;
  const keyCostCents = (raw.key_cost_cents as number) ?? 0;
  const keyCostCurrency = (raw.key_cost_currency as string) ?? 'USD';
  const qty = (raw.quantity as number) ?? 1;
  const isMarketplace = (raw.order_channel as string) === 'marketplace';
  const channel = resolveChannel(raw);

  const keyCostInOrderCurrency = convertCents(keyCostCents, keyCostCurrency, currency, rates);

  const totalCost = isMarketplace ? providerFee + keyCostInOrderCurrency : keyCostInOrderCurrency;
  const profit = isMarketplace ? netAmount - keyCostInOrderCurrency : totalAmount - keyCostInOrderCurrency;

  const dc = DISPLAY_CURRENCY;
  const toDisplay = (cents: number, from: string) => convertCents(cents, from, dc, rates);

  const grossAud = toDisplay(totalAmount, currency);
  const netAud = toDisplay(netAmount, currency);
  const feeAud = toDisplay(providerFee, currency);
  const keyCostAud = toDisplay(keyCostCents, keyCostCurrency);
  // When Net is seller proceeds (marketplace), costAud = keys only;
  // marketplace fee is informational on the Mkt: line.
  const costAudAmount = isMarketplace ? keyCostAud : keyCostAud;
  const profitAud = isMarketplace ? netAud - keyCostAud : grossAud - keyCostAud;

  const profitInOrderCurrency = profit;

  const money = { amount: totalAmount, currency };
  return {
    order: {
      id: raw.id as string,
      orderNumber: (raw.order_number as string) ?? null,
      channel,
      status: mapStatus(raw.status as string),
      productName: extractProductName(raw),
      sku: extractVariantSku(raw) || (raw.order_number as string) || '',
      qty,
      revenue: money,
      cost: { amount: totalCost, currency },
      unitPrice: money,
      placedAt: raw.created_at as string,
      customer: (raw.contact_email as string) ?? (raw.delivery_email as string) ?? (raw.guest_email as string) ?? 'Guest',
      profit: { amount: profitInOrderCurrency, currency },
      items: serializeOrderItems(raw),
    },
    presentation: {
      paidTotal: { amount: totalAmount, currency },
      paidGrossAud: { amount: grossAud, currency: dc },
      paidNetAud: isMarketplace ? { amount: netAud, currency: dc } : null,
      processorFeeAud: feeAud > 0 ? { amount: feeAud, currency: dc } : null,
      channelFeeAud: isMarketplace && feeAud > 0 ? { amount: feeAud, currency: dc } : null,
      productCostAud: keyCostAud > 0 ? { amount: keyCostAud, currency: dc } : null,
      costAud: costAudAmount > 0 ? { amount: costAudAmount, currency: dc } : null,
      profitAud: { amount: profitAud, currency: dc },
      netIsSellerProceedsAfterMkt: isMarketplace,
      processorFeeLinePrefix: isMarketplace ? 'Mkt:' as const : 'Net:' as const,
      kpiProfitUsd: { amount: profitInOrderCurrency, currency },
    },
  };
}

export async function adminOrderRoutes(app: FastifyInstance) {
  const getDb = () => container.resolve<IDatabase>(TOKENS.Database);

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
    const [result, rates] = await Promise.all([
      uc.execute({
        page: Math.floor(offset / limit) + 1,
        limit,
        status: query.status,
        from: query.from,
        to: query.to,
      }),
      loadCurrencyRates(getDb()),
    ]);

    const shaped = {
      orders: (result.orders as Record<string, unknown>[]).map(o => toSerializedOrder(o, rates)),
      total: result.total,
    };
    return reply.send(shaped);
  });

  app.get('/:orderId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const uc = container.resolve<GetOrderDetailUseCase>(UC_TOKENS.GetOrderDetail);
    const [raw, rates] = await Promise.all([
      uc.execute(orderId) as Promise<Record<string, unknown> | null>,
      loadCurrencyRates(getDb()),
    ]);
    if (!raw) return reply.code(404).send({ error: 'Order not found' });

    const keyCostCents = computeKeyCost(raw);
    const keyCostCurrency = resolveKeyCostCurrency(raw);
    const enriched = { ...raw, key_cost_cents: keyCostCents, key_cost_currency: keyCostCurrency };
    const serialized = toSerializedOrder(enriched, rates);

    const deliveredKeys = (raw.delivered_keys as Array<Record<string, unknown>>) ?? [];
    return reply.send({
      ...serialized,
      detail: {
        ipAddress: raw.ip_address ?? null,
        ipCountry: raw.ip_country ?? null,
        billingCountry: raw.billing_country_code ?? null,
        paymentMethod: raw.payment_method ?? null,
        notes: raw.notes ?? null,
        adminNotes: raw.admin_notes ?? null,
        refundAmount: raw.refund_amount ?? null,
        refundReason: raw.refund_reason ?? null,
        refundedAt: raw.refunded_at ?? null,
        discountAmount: raw.discount_amount_cents ?? null,
        subtotal: raw.subtotal_cents ?? null,
        deliveredKeys: deliveredKeys.map(k => ({
          id: k.id,
          variantId: k.variant_id,
          state: k.key_state,
          purchaseCost: k.purchase_cost ?? 0,
          purchaseCurrency: k.purchase_currency ?? 'USD',
          usedAt: k.used_at ?? null,
          createdAt: k.created_at ?? null,
          supplierReference: k.supplier_reference ?? null,
        })),
      },
    });
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
