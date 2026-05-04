/**
 * Eneba GraphQL API response types.
 *
 * These mirror Eneba's seller-side GraphQL schema. Kept separate from
 * internal domain types so changes to Eneba's API surface are isolated
 * to this file + the adapter.
 */

export interface EnebaGraphQLResponse<T> {
  data?: T;
  errors?: EnebaGraphQLError[];
  extensions?: Record<string, unknown>;
}

export interface EnebaGraphQLError {
  message: string;
  path?: string[];
  extensions?: {
    code?: string;
    classification?: string;
    [key: string]: unknown;
  };
}

export interface EnebaPrice {
  amount: number;
  currency: string;
}

export interface EnebaDrm {
  slug: string;
}

export interface EnebaProductType {
  value: string;
}

export interface EnebaRegion {
  code: string;
}

// ─── Product (from S_products / S_product) ──────────────────────────

export interface EnebaProduct {
  id: string;
  name: string;
  slug: string;
  drm: EnebaDrm | null;
  type: EnebaProductType | null;
  regions: EnebaRegion[];
  createdAt?: string;
  releasedAt?: string;
  languages?: string[];
}

export interface EnebaPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface EnebaProductConnection {
  edges: Array<{ node: EnebaProduct; cursor?: string }>;
  totalCount?: number;
  pageInfo?: EnebaPageInfo;
}

export interface EnebaSearchProductsData {
  S_products: EnebaProductConnection;
}

export interface EnebaGetProductData {
  S_product: EnebaProduct | null;
}

// ─── Competition (from S_competition) ───────────────────────────────

export interface EnebaCompetitor {
  belongsToYou: boolean;
  merchantName: string;
  price: EnebaPrice;
}

export interface EnebaCompetitorConnection {
  totalCount: number;
  edges: Array<{ node: EnebaCompetitor }>;
}

export interface EnebaCompetition {
  productId: string;
  competition: EnebaCompetitorConnection;
}

export interface EnebaCompetitionData {
  S_competition: EnebaCompetition[];
}

// ─── Auction (from S_createAuction / S_updateAuction) ────────────────

export interface EnebaCreateAuctionData {
  S_createAuction: {
    success: boolean;
    actionId: string;
    auctionId: string;
  };
}

export interface EnebaUpdateAuctionData {
  S_updateAuction: {
    success: boolean;
    actionId: string;
    price: EnebaPrice | null;
    priceChanged: boolean | null;
    paidForPriceChange: boolean | null;
  };
}

export interface EnebaRemoveAuctionData {
  S_removeAuction: { actionId: string; success: boolean };
}

// ─── Stock Query (from S_stock) ──────────────────────────────────────

export interface EnebaCommission {
  rate: EnebaPrice;
  label: string;
}

export interface EnebaStockCompetitorNode {
  belongsToYou: boolean;
  price: EnebaPrice;
}

export interface EnebaPriceUpdateQuota {
  quota: number;
  nextFreeIn: number | null;
  totalFree: number;
}

export interface EnebaStockNode {
  id: string;
  product: { id: string; name: string };
  status: string;
  declaredStock: number | null;
  onHand: number;
  onHold: number;
  unitsSold: number;
  price: EnebaPrice;
  position: number | null;
  commission?: EnebaCommission;
  autoRenew: boolean;
  createdAt: string;
  priceUpdateQuota?: EnebaPriceUpdateQuota | null;
  competition?: {
    edges: Array<{ node: EnebaStockCompetitorNode }>;
  };
}

export interface EnebaStockConnection {
  edges: Array<{ node: EnebaStockNode }>;
  totalCount: number;
  pageInfo?: EnebaPageInfo;
}

export interface EnebaGetStockData {
  S_stock: EnebaStockConnection;
}

// ─── Price Calculator (from S_calculatePrice) ───────────────────────

export interface EnebaCalculatePriceResult {
  priceWithCommission: EnebaPrice;
  priceWithoutCommission: EnebaPrice;
  commission: EnebaCommission;
}

export interface EnebaCalculatePriceData {
  S_calculatePrice: EnebaCalculatePriceResult;
}

// ─── Callbacks (from P_registerCallback / P_apiCallbacks) ────────────

export type EnebaCallbackType =
  | 'DECLARED_STOCK_RESERVATION'
  | 'DECLARED_STOCK_PROVISION'
  | 'DECLARED_STOCK_CANCELLATION'
  | 'DECLARED_STOCK_REPLACEMENT_RESERVATION'
  | 'DECLARED_STOCK_REPLACEMENT_PROVISION';

export interface EnebaCallback {
  id: string;
  url: string;
  type: EnebaCallbackType;
  authorization?: string;
}

export interface EnebaRegisterCallbackData {
  P_registerCallback: {
    success: boolean;
  };
}

export interface EnebaRemoveCallbackData {
  P_removeCallback: { success: boolean };
}

export interface EnebaGetCallbacksData {
  P_apiCallbacks: EnebaCallback[];
}

export interface EnebaEnableDeclaredStockData {
  P_enableDeclaredStock: {
    success: boolean;
    failureReason: string | null;
  };
}

// ─── Batch Declared Stock (P_updateDeclaredStock) ───────────────────

export interface EnebaUpdateDeclaredStockData {
  P_updateDeclaredStock: { success: boolean };
}

// ─── Batch Price Update (P_updateAuctionPrice) ──────────────────────

export interface EnebaAuctionPriceItem {
  auctionId: string;
  price: EnebaPrice | null;
  priceIWantToGet: EnebaPrice | null;
  success: boolean;
  paidForPriceChange: boolean;
  error: string | null;
}

export interface EnebaUpdateAuctionPriceData {
  P_updateAuctionPrice: { items: EnebaAuctionPriceItem[] };
}

// ─── Global Stock Status (P_updateStockStatus) ──────────────────────

export interface EnebaUpdateStockStatusData {
  P_updateStockStatus: { success: boolean };
}

// ─── Key Replacements (P_enableDeclaredStockKeyReplacements) ────────

export interface EnebaEnableKeyReplacementsData {
  P_enableDeclaredStockKeyReplacements: { success: boolean };
}

// ─── Batch ──────────────────────────────────────────────────────────

export interface BatchOperation {
  name: string;
  query: string;
  variables: Record<string, unknown>;
}
