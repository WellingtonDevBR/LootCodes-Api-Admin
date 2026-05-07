/**
 * Bamboo Card Portal API types (mirrored from Edge Function adapter).
 *
 * Catalog V2: GET /api/integration/v2.0/catalog
 * Orders V1:  POST /api/integration/v1.0/orders/checkout
 *             GET  /api/integration/v1.0/orders/{requestId}
 * Auth: HTTP Basic (ClientId:ClientSecret)
 */

// ─── Catalog V2 ─────────────────────────────────────────────────────

export interface BambooProductPrice {
  min: number;
  max: number;
  currencyCode: string;
}

export interface BambooProduct {
  id: number;
  name: string;
  minFaceValue: number;
  maxFaceValue: number;
  count: number | null;
  price: BambooProductPrice;
  modifiedDate: string;
  isDeleted?: boolean;
  status?: string | null;
}

export interface BambooCategory {
  id: number;
  name: string;
  description: string | null;
}

export interface BambooBrand {
  internalId: string;
  name: string;
  countryCode: string;
  currencyCode: string;
  description: string | null;
  disclaimer: string | null;
  redemptionInstructions: string | null;
  terms: string | null;
  logoUrl: string | null;
  modifiedDate: string;
  products: BambooProduct[];
  categories?: BambooCategory[];
}

export interface BambooCatalogResponse {
  pageIndex: number;
  pageSize: number;
  count: number;
  items: BambooBrand[];
}

// ─── Orders V1 ──────────────────────────────────────────────────────

export interface BambooCard {
  id: number;
  serialNumber: string;
  cardCode: string;
  pin: string | null;
  expirationDate: string | null;
  status: string;
}

export interface BambooOrderItem {
  brandCode: string | null;
  productId: number;
  productFaceValue: number;
  quantity: number;
  pictureUrl: string | null;
  countryCode: string;
  currencyCode: string;
  status: string;
  cards: BambooCard[];
}

export interface BambooOrderResponse {
  orderId: number;
  requestId: string;
  items: BambooOrderItem[];
  status: string;
  createdDate: string;
  total: number;
  errorMessage: string | null;
  orderType: string;
  currency: string;
}

/** GET …/v1.0/accounts — balances and sandbox vs live flags */
export interface BambooAccount {
  readonly id: number;
  readonly currency: string;
  readonly balance: number;
  readonly isActive: boolean;
  readonly sandboxMode: boolean;
}

export interface BambooAccountsResponse {
  readonly accounts: BambooAccount[];
}

// Notification callback types live in core/use-cases/seller-webhook/bamboo/bamboo-parser.ts
// (core must not depend on infra; the parser owns the payload interface)
