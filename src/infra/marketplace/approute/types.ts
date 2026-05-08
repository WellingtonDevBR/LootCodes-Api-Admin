/**
 * AppRoute Public API — typed snapshots for catalog (`GET services`) and order payloads.
 * Extend when the vendor publishes fuller schemas.
 */
export interface AppRouteServiceDenomination {
  readonly id: string;
  readonly name?: string;
  readonly price?: number | string;
  readonly currency?: string;
  readonly countryCode?: string;
  /** API returns boolean or numeric stock level (e.g. `500`). */
  readonly inStock?: boolean | number;
  readonly quantity?: number;
  readonly fields?: unknown;
  readonly type?: string;
  readonly isLongOrder?: boolean;
  readonly minQtyToLongOrder?: number;
}

export interface AppRouteServiceNode {
  readonly id: string;
  readonly name?: string;
  /** Region / market code on the service (denominations often omit this). */
  readonly countryCode?: string;
  readonly items?: readonly AppRouteServiceDenomination[];
  readonly fields?: unknown;
  readonly type?: string;
}

export interface AppRouteServicesData {
  readonly items?: readonly AppRouteServiceNode[];
}

/** One wallet row from `GET /accounts` — amounts are major units (e.g. USD dollars). */
export interface AppRouteAccountItem {
  readonly currency: string;
  readonly balance?: number;
  readonly available?: number;
  readonly reserved?: number;
  readonly overdraftLimit?: number;
}

export interface AppRouteAccountsData {
  readonly items?: readonly AppRouteAccountItem[];
}

export interface AppRouteEnvelopeShape<T = unknown> {
  readonly status?: string;
  readonly statusCode?: number;
  readonly statusMessage?: string;
  readonly traceId?: string;
  readonly data?: T;
  readonly errors?: readonly unknown[];
}

// ─── DTU (Direct Top-Up) types ──────────────────────────────────────────
//
// DTU orders top up a target account directly (mobile balance, gaming
// wallet, etc.) and do NOT return voucher codes.

export interface AppRouteDtuOrderField {
  readonly key: string;
  readonly value: string;
}

export interface AppRouteDtuOrderLine {
  readonly denominationId: string;
  readonly quantity: number;
  readonly amountCurrencyCode?: string;
  readonly fields?: readonly AppRouteDtuOrderField[];
}

export interface AppRouteDtuOrderRequest {
  readonly referenceId: string;
  readonly orders: readonly AppRouteDtuOrderLine[];
}

export interface AppRouteDtuCheckRequest {
  readonly orders: readonly AppRouteDtuOrderLine[];
}

export interface AppRouteDtuOrderResult {
  readonly orderId: string;
  readonly status: string;
  readonly price?: number;
  readonly currency?: string;
  readonly result?: {
    readonly vouchers?: unknown;
    readonly attributes?: Record<string, unknown> | null;
  };
}

export interface AppRouteDtuCheckResult {
  readonly canRecharge: boolean;
  readonly price: number;
  readonly currency: string;
  readonly providerStatus: string;
  readonly providerMessage?: string;
  readonly attributes?: Record<string, unknown>;
}
