/**
 * Digiseller/Plati.market API response types (seller-side).
 *
 * Prices are floats (e.g. 7.25), not cents.
 * Product IDs are integers.
 * Token transport: query param `?token=X`, not Authorization header.
 * Pricing model: 'gross' (customer-visible price).
 */

// ─── Generic API Envelope ─────────────────────────────────────────────

export interface DigisellerError {
  code: string;
  message: string | Array<{ locale: string; value: string }>;
}

export interface DigisellerApiResponse {
  retval: number;
  retdesc: string | null;
  errors?: DigisellerError[] | null;
}

// ─── Product CRUD ─────────────────────────────────────────────────────

export interface DigisellerProductName {
  locale: string;
  value: string;
}

export interface DigisellerProductDescription {
  locale: string;
  value: string;
}

export interface DigisellerProductPrice {
  price: number;
  currency: string;
}

export interface DigisellerProductCategory {
  owner?: number;
  category_id: number;
}

export interface DigisellerCreateProductRequest {
  content_type?: string;
  name: DigisellerProductName[];
  price: DigisellerProductPrice;
  description: DigisellerProductDescription[];
  categories?: DigisellerProductCategory[];
  guarantee?: { enabled: boolean; value: number };
  sales_limit?: number;
  enabled?: boolean;
}

export interface DigisellerCreateProductResponse extends DigisellerApiResponse {
  content: { product_id: number };
}

export type DigisellerEditProductResponse = DigisellerApiResponse;

// ─── Product Status ───────────────────────────────────────────────────

export type DigisellerProductStatusResponse = DigisellerApiResponse;

// ─── Product Data ─────────────────────────────────────────────────────

export interface DigisellerProductDataPayload {
  id: number;
  name: string;
  price: number;
  currency: string;
  is_available?: number;
  num_in_stock?: number;
  prices?: {
    initial?: { price: number; currency: string };
    default?: { price: number; currency: string };
  };
}

export interface DigisellerProductDataResponse {
  retval: number;
  retdesc?: string;
  product?: DigisellerProductDataPayload;
}

// ─── Content / Key Upload ─────────────────────────────────────────────

export interface DigisellerTextContentItem {
  serial: string;
  value: string;
}

export interface DigisellerAddTextContentRequest {
  product_id: number;
  content: DigisellerTextContentItem[];
}

export interface DigisellerAddTextContentResponse extends DigisellerApiResponse {
  content?: { added: number; content_ids?: number[] };
}

// ─── Stock Count ──────────────────────────────────────────────────────

export interface DigisellerCodeCountResponse {
  retval: number;
  retdesc: string | null;
  cnt_goods: number;
}
