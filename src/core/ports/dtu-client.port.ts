/**
 * IDtuClient — vendor-agnostic Direct Top-Up (DTU) capability.
 *
 * The first concrete adapter wraps AppRoute's `POST /orders` with
 * `ordersType: "dtu"`. The use case depends on this port so other
 * providers can be plugged in later without touching the use case.
 *
 * NOTE: DTU orders top up an external account (mobile balance, gaming
 * wallet, etc.) and do NOT return product keys. Treat results as recharge
 * receipts, not vouchers.
 */

export interface DtuOrderField {
  readonly key: string;
  readonly value: string;
}

export interface DtuOrderLineInput {
  readonly denominationId: string;
  readonly quantity: number;
  readonly amountCurrencyCode?: string;
  readonly fields?: readonly DtuOrderField[];
}

export interface DtuPlaceOrderInput {
  readonly referenceId: string;
  readonly orders: readonly DtuOrderLineInput[];
}

export interface DtuCheckInput {
  readonly orders: readonly DtuOrderLineInput[];
}

export interface DtuPlaceOrderResult {
  readonly orderId: string;
  readonly status: string;
  readonly price?: number;
  readonly currency?: string;
  readonly attributes?: Record<string, unknown> | null;
}

export interface DtuCheckResult {
  readonly canRecharge: boolean;
  readonly price: number;
  readonly currency: string;
  readonly providerStatus: string;
  readonly providerMessage?: string;
  readonly attributes?: Record<string, unknown>;
}

export interface IDtuClient {
  readonly providerCode: string;
  placeOrder(input: DtuPlaceOrderInput): Promise<DtuPlaceOrderResult>;
  check(input: DtuCheckInput): Promise<DtuCheckResult>;
}

/** Resolves a `IDtuClient` for a given `provider_accounts.id`. */
export interface IDtuClientFactory {
  resolve(providerAccountId: string): Promise<IDtuClient | null>;
}
