/**
 * G2A marketplace API types.
 *
 * G2A exposes two APIs:
 *   - Export API (buyer/public): product catalog, offers listing
 *   - Import API (seller): offer CRUD, pricing, inventory management
 *
 * All prices are float EUR strings (e.g. "5.98") unless noted otherwise.
 */

// ─── Export API (Buyer) Types ─────────────────────────────────────────

export interface G2AProduct {
  id: number | string;
  name: string;
  slug: string;
  minPrice: number;
  qty: number;
  availableToBuy: boolean;
  platform?: string;
  retailMinPrice?: number;
  wholesaleMinPrice?: number;
}

export interface G2AProductListResponse {
  docs: G2AProduct[];
  total: number;
}

// ─── Import API (Seller) Types ────────────────────────────────────────

export type G2AOfferType =
  | 'dropshipping'
  | 'game'
  | 'promo'
  | 'preorder'
  | 'physical'
  | 'steamgift';

export type G2AVisibility = 'all' | 'retail' | 'business';

export interface G2AOfferDetail {
  id: string;
  type: string;
  status: string;
  product: { id: string | number; name: string };
  visibility?: string;
  inventory: { size: number; soldCount?: number };
  price: {
    retail?: { base?: { value: string; currencyCode: string } };
    business?: { base?: { value: string; currencyCode: string } };
  };
  priceLimit?: { min: number; max: number };
  active: boolean;
  createdAt?: string;
}

export interface G2AOfferListResponse {
  data: G2AOfferDetail[];
  meta?: { page: number; itemsPerPage: number; totalResults: number };
}

export interface G2AOfferDetailResponse {
  data: G2AOfferDetail;
}

export interface G2ACreateOfferRequest {
  offerType: G2AOfferType;
  variants: Array<{
    productId: string;
    price: { retail?: string; business?: string };
    active: boolean;
    inventory: { size: number };
    visibility?: G2AVisibility;
  }>;
}

export interface G2AUpdateOfferRequest {
  offerType: G2AOfferType;
  variant: G2AUpdateOfferVariant;
}

export interface G2AUpdateOfferVariant {
  price?: { retail?: string; business?: string };
  inventory?: { size: number };
  active?: boolean;
  visibility?: G2AVisibility;
}

export interface G2AJobResponse {
  data?: { jobId: string };
}

export interface G2AJobStatusResponse {
  data: {
    jobId: string;
    status: string;
    elements?: Array<{
      resourceId: string;
      resourceType?: string;
      status?: string;
      code?: string;
      message?: string;
    }>;
  };
}

export interface G2AJobPollResult {
  ok: boolean;
  resourceId?: string;
  code?: string;
  message?: string;
  status: string;
}

// ─── Pricing Simulation ──────────────────────────────────────────────

export interface G2APricingSimulation {
  income?: Record<string, number>;
  businessIncome?: Record<string, number>;
  finalePrice?: Record<string, number>;
}

// ─── Product Offers (Export API) ─────────────────────────────────────

export interface G2AProductOffersResponse {
  data: Array<{
    id: string;
    seller?: { name: string };
    price?: {
      retail?: { base?: { value: string; currencyCode: string } };
    };
    inventory?: { range: string };
  }>;
}
