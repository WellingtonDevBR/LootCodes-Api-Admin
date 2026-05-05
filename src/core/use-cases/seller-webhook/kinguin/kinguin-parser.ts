// Kinguin webhook payload parser — centralises Kinguin-specific
// normalisation, validation, and response construction.

import { floatToCents } from '../../../../shared/pricing.js';

// --- Status normalisation ---------------------------------------------------

const STATUS_ALIASES: Record<string, string> = {
  buying: 'BUYING',
  reserve: 'BUYING',
  bought: 'BOUGHT',
  give: 'BOUGHT',
  out_of_stock: 'OUT_OF_STOCK',
  outofstock: 'OUT_OF_STOCK',
  canceled: 'CANCELED',
  cancelled: 'CANCELED',
  reversed: 'REVERSED',
  delivered: 'DELIVERED',
  returned: 'RETURNED',
  refunded: 'REFUNDED',
  processing_preorder: 'PROCESSING_PREORDER',
  processingpreorder: 'PROCESSING_PREORDER',
  offer_blocked: 'OFFER_BLOCKED',
  offerblocked: 'OFFER_BLOCKED',
  processing_ingame: 'PROCESSING_INGAME',
  processingingame: 'PROCESSING_INGAME',
  chat_message: 'CHAT_MESSAGE',
  chatmessage: 'CHAT_MESSAGE',
  order_processing: 'ORDER_PROCESSING',
  orderprocessing: 'ORDER_PROCESSING',
};

export function normalizeKinguinWebhookStatus(raw: string | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  const key = raw.trim().toLowerCase();
  return STATUS_ALIASES[key] ?? raw.trim().toUpperCase();
}

// --- Ordered quantity -------------------------------------------------------

export const MAX_KINGUIN_ORDER_KEYS = 50;

export function resolveOrderedQuantity(payload: {
  quantity?: unknown;
  keyCount?: unknown;
  amount?: unknown;
}): number {
  const raw =
    typeof payload.quantity === 'number' ? payload.quantity
      : typeof payload.keyCount === 'number' ? payload.keyCount
        : typeof payload.amount === 'number' ? payload.amount
          : 1;
  return Math.min(Math.max(1, Math.trunc(raw)), MAX_KINGUIN_ORDER_KEYS);
}

// --- External order ID ------------------------------------------------------

export function resolveKinguinExternalOrderId(
  reservationId: string,
  orderIncrementId: string | null | undefined,
): string {
  return orderIncrementId?.trim() || reservationId;
}

// --- MIME type mapping ------------------------------------------------------

export const KINGUIN_STOCK_MAX_BODY_BYTES = 200 * 1024;
export const KINGUIN_STOCK_ALLOWED_MIME_TYPES = [
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/gif',
] as const;

export type KinguinStockMimeType = (typeof KINGUIN_STOCK_ALLOWED_MIME_TYPES)[number];

export function isKinguinStockMimeType(value: string): value is KinguinStockMimeType {
  return (KINGUIN_STOCK_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

export function mimeTypeForProductKeyFormat(keyFormat: string): KinguinStockMimeType {
  const lower = (keyFormat ?? '').toLowerCase();
  if (lower === 'image/jpeg' || lower === 'jpeg' || lower === 'jpg') return 'image/jpeg';
  if (lower === 'image/png' || lower === 'png') return 'image/png';
  if (lower === 'image/gif' || lower === 'gif') return 'image/gif';
  return 'text/plain';
}

// --- Declared stock cap -----------------------------------------------------

export { KINGUIN_MAX_DECLARED_STOCK, capKinguinDeclaredStock } from '../../../shared/kinguin.constants.js';

// --- Provider metadata builder ----------------------------------------------

export interface KinguinWebhookPayload {
  name?: string;
  price?: number;
  priceIWTR?: number;
  commissionRule?: string;
  productId?: string;
  offerId?: string;
  status?: string;
  reservationId?: string;
  declaredStock?: number;
  stock?: number;
  soldStock?: number;
  cancelledStock?: number;
  requestedKeyType?: string;
  quantity?: number;
  keyCount?: number;
  amount?: number;
  orderIncrementId?: string;
  wholesale?: unknown;
  errorMessage?: string;
  errorCode?: string;
  blockedReason?: string;
}

export function buildBuyingProviderMetadata(
  payload: KinguinWebhookPayload,
  orderQty: number,
): Record<string, unknown> {
  return {
    kinguinProductId: payload.productId,
    kinguinOfferId: payload.offerId,
    kinguinReservationId: payload.reservationId,
    orderIncrementId: payload.orderIncrementId ?? null,
    requestedKeyType: payload.requestedKeyType ?? null,
    orderedQuantity: orderQty,
    stock: payload.stock ?? null,
    declaredStock: payload.declaredStock ?? null,
    soldStock: payload.soldStock ?? null,
    name: payload.name ?? null,
    wholesale: payload.wholesale ?? null,
    kinguinWebhookStatus: 'BUYING',
  };
}

// --- Financials mapping -----------------------------------------------------

export function resolveKinguinSalePricing(
  payload: KinguinWebhookPayload,
): { grossCents: number; netCents: number; currency: string } | null {
  const gross = payload.price;
  const net = payload.priceIWTR;

  if (typeof gross !== 'number' || !Number.isFinite(gross)) return null;
  if (typeof net !== 'number' || !Number.isFinite(net)) {
    return { grossCents: floatToCents(gross), netCents: floatToCents(gross), currency: 'EUR' };
  }
  return {
    grossCents: floatToCents(gross),
    netCents: floatToCents(net),
    currency: 'EUR',
  };
}

// --- Payload parsing + validation -------------------------------------------

export class KinguinParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KinguinParseError';
  }
}

export function parseKinguinWebhookPayload(body: unknown): KinguinWebhookPayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new KinguinParseError('Kinguin webhook body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;
  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    price: typeof raw.price === 'number' ? raw.price : undefined,
    priceIWTR: typeof raw.priceIWTR === 'number' ? raw.priceIWTR : undefined,
    commissionRule: typeof raw.commissionRule === 'string' ? raw.commissionRule : undefined,
    productId: typeof raw.productId === 'string' ? raw.productId : undefined,
    offerId: typeof raw.offerId === 'string' ? raw.offerId : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    reservationId: typeof raw.reservationId === 'string' ? raw.reservationId : undefined,
    declaredStock: typeof raw.declaredStock === 'number' ? raw.declaredStock : undefined,
    stock: typeof raw.stock === 'number' ? raw.stock : undefined,
    soldStock: typeof raw.soldStock === 'number' ? raw.soldStock : undefined,
    cancelledStock: typeof raw.cancelledStock === 'number' ? raw.cancelledStock : undefined,
    requestedKeyType: typeof raw.requestedKeyType === 'string' ? raw.requestedKeyType : undefined,
    quantity: typeof raw.quantity === 'number' ? raw.quantity : undefined,
    keyCount: typeof raw.keyCount === 'number' ? raw.keyCount : undefined,
    amount: typeof raw.amount === 'number' ? raw.amount : undefined,
    orderIncrementId: typeof raw.orderIncrementId === 'string' ? raw.orderIncrementId : undefined,
    wholesale: raw.wholesale,
    errorMessage: typeof raw.errorMessage === 'string' ? raw.errorMessage : undefined,
    errorCode: typeof raw.errorCode === 'string' ? raw.errorCode : undefined,
    blockedReason: typeof raw.blockedReason === 'string' ? raw.blockedReason : undefined,
  };
}
