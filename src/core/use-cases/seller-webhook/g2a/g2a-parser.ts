/**
 * Pure functions for parsing/validating G2A dropshipping contract payloads
 * and building G2A-shaped responses.
 *
 * Keeps all G2A-specific JSON formatting isolated from handler logic.
 * Mirrors the Edge Function's g2a-parser.ts pattern.
 */
import type {
  G2AReservationRequestItem,
  G2AStockItem,
  G2AStockInventoryItem,
  G2AReservationResponse,
  G2AOrderCreatedResponse,
  G2ANotificationItem,
  G2AContractError,
} from './seller-webhook.types.js';

// --- Request Parsers ---

export class G2AParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'G2AParseError';
  }
}

export function parseReservationRequest(body: unknown): G2AReservationRequestItem[] {
  if (!Array.isArray(body) || body.length === 0) {
    throw new G2AParseError('Reservation request must be a non-empty array');
  }

  return body.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new G2AParseError(`Invalid reservation item at index ${index}`);
    }

    const raw = item as Record<string, unknown>;
    const productId = Number(raw.product_id);
    const quantity = Number(raw.quantity);

    if (!productId || Number.isNaN(productId)) {
      throw new G2AParseError(`Invalid product_id at index ${index}`);
    }
    if (!quantity || Number.isNaN(quantity) || quantity < 1) {
      throw new G2AParseError(`Invalid quantity at index ${index}`);
    }

    return {
      product_id: productId,
      quantity,
      additional_data: raw.additional_data as Record<string, unknown> | undefined,
    };
  });
}

export function parseOrderRequest(body: unknown): { reservation_id: string; g2a_order_id: number } {
  if (!body || typeof body !== 'object') {
    throw new G2AParseError('Invalid order request body');
  }

  const raw = body as Record<string, unknown>;
  const reservationId = raw.reservation_id;
  const g2aOrderId = Number(raw.g2a_order_id);

  if (typeof reservationId !== 'string' || !reservationId.trim()) {
    throw new G2AParseError('Missing or invalid reservation_id');
  }
  if (!g2aOrderId || Number.isNaN(g2aOrderId)) {
    throw new G2AParseError('Missing or invalid g2a_order_id');
  }

  return {
    reservation_id: reservationId.trim(),
    g2a_order_id: g2aOrderId,
  };
}

export function parseNotifications(body: unknown): G2ANotificationItem[] {
  if (!Array.isArray(body) || body.length === 0) {
    throw new G2AParseError('Notifications must be a non-empty array');
  }

  return body.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new G2AParseError(`Invalid notification at index ${index}`);
    }

    const raw = item as Record<string, unknown>;
    const notificationType = raw.notification_type;
    const date = raw.date;
    const data = raw.data;

    if (typeof notificationType !== 'string') {
      throw new G2AParseError(`Missing notification_type at index ${index}`);
    }
    if (typeof date !== 'string') {
      throw new G2AParseError(`Missing date at index ${index}`);
    }
    if (!data || typeof data !== 'object') {
      throw new G2AParseError(`Missing data at index ${index}`);
    }

    return {
      notification_type: notificationType as 'auction_deactivated',
      date,
      data: data as { product_id: number; offer_id?: string },
    };
  });
}

// --- Response Builders ---

export function buildStockInventoryItem(
  keyId: string,
  value: string,
  kind: 'text' | 'image' | 'account' = 'text',
): G2AStockInventoryItem {
  return { id: keyId, value, kind };
}

export function buildStockItem(
  productId: number,
  inventorySize: number,
  inventory: G2AStockInventoryItem[],
): G2AStockItem {
  return {
    product_id: productId,
    inventory_size: inventorySize,
    inventory,
  };
}

export function buildReservationResponse(
  reservationId: string,
  stock: G2AStockItem[],
): G2AReservationResponse {
  return { reservation_id: reservationId, stock };
}

export function buildOrderResponse(
  orderId: string,
  stock: G2AStockItem[],
): G2AOrderCreatedResponse {
  return { order_id: orderId, stock };
}

export function buildContractError(code: string, message: string): G2AContractError {
  return { code, message };
}