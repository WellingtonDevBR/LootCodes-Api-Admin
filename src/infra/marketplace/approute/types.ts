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

export interface AppRouteEnvelopeShape<T = unknown> {
  readonly status?: string;
  readonly statusCode?: number;
  readonly statusMessage?: string;
  readonly traceId?: string;
  readonly data?: T;
  readonly errors?: readonly unknown[];
}
