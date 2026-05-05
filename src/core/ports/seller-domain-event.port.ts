/**
 * Seller domain event emission port.
 *
 * Two event categories:
 *   1. `seller.*` — audit-only INSERT to `domain_events` (no observer dispatch today)
 *   2. `inventory.stock_changed` — INSERT + invoke `event-dispatcher` for observer fan-out
 *      (Algolia sync, seller stock cross-marketplace sync, admin alerts)
 */

export type SellerEventType =
  | 'seller.listing_created'
  | 'seller.listing_updated'
  | 'seller.listing_removed'
  | 'seller.stock_reserved'
  | 'seller.stock_provisioned'
  | 'seller.stock_cancelled'
  | 'seller.sale_completed'
  | 'seller.key_replaced'
  | 'seller.sale_refunded'
  | 'seller.reservation_expired'
  | 'seller.variant_unavailable_propagated'
  | 'procurement.order_succeeded'
  | 'procurement.order_failed';

export type InventoryStockChangeReason =
  | 'keys_assigned'
  | 'keys_released'
  | 'keys_added'
  | 'keys_deleted'
  | 'seller_reserved'
  | 'seller_provisioned'
  | 'seller_cancelled';

export interface EmitSellerEventParams {
  eventType: SellerEventType;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export interface EmitInventoryStockChangedParams {
  productIds: string[];
  variantIds?: string[];
  reason: InventoryStockChangeReason;
  orderId?: string;
}

export interface ISellerDomainEventPort {
  /**
   * Emit a seller domain event (audit-only, INSERT into `domain_events`).
   * Returns true on success, false on failure. Non-throwing.
   */
  emitSellerEvent(params: EmitSellerEventParams): Promise<boolean>;

  /**
   * Emit an inventory stock changed event.
   * INSERT into `domain_events` + POST to `event-dispatcher` Edge Function
   * for observer fan-out (Algolia, seller stock sync, admin alerts).
   */
  emitInventoryStockChanged(params: EmitInventoryStockChangedParams): Promise<void>;
}
