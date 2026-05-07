const VALID_PRODUCT_TYPES = ['key', 'account', 'gift_card', 'subscription', 'dlc', 'software'] as const;
const VALID_DELIVERY_TYPES = ['instant', 'manual', 'pre_order'] as const;
const VALID_CATEGORIES = ['games', 'software', 'gift_cards', 'subscriptions', 'dlc', 'other'] as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PRICE_CENTS = 99999999;

/** Next.js RSC / Flight may serialize missing fields as this literal string. */
const SENTINEL_UNDEFINED = '$undefined';

export type ProductType = typeof VALID_PRODUCT_TYPES[number];
export type DeliveryType = typeof VALID_DELIVERY_TYPES[number];
export type ProductCategory = typeof VALID_CATEGORIES[number];

export function isValidProductType(value: string): value is ProductType {
  return (VALID_PRODUCT_TYPES as readonly string[]).includes(value);
}

export function isValidDeliveryType(value: string): value is DeliveryType {
  return (VALID_DELIVERY_TYPES as readonly string[]).includes(value);
}

export function isValidCategory(value: string): value is ProductCategory {
  return (VALID_CATEGORIES as readonly string[]).includes(value);
}

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Parse optional UUID from JSON/admin proxy bodies. Treats absent values,
 * empty strings, and the Flight/RSC `"$undefined"` sentinel as missing.
 */
export function parseOptionalUuid(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  if (t === '' || t === SENTINEL_UNDEFINED) return undefined;
  if (!isValidUuid(t)) return undefined;
  return t;
}

export function parseOptionalRetailPriceUsd(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '' || t === SENTINEL_UNDEFINED) return undefined;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return n;
  }
  return undefined;
}

export function isValidPriceCents(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_PRICE_CENTS;
}

export function resolveCategoryFromType(productType: string): ProductCategory {
  const map: Record<string, ProductCategory> = {
    key: 'games', account: 'games', gift_card: 'gift_cards',
    subscription: 'subscriptions', dlc: 'dlc', software: 'software',
  };
  return map[productType] ?? 'games';
}

export interface VariantValidationError {
  index: number;
  error: string;
}

export function validateVariantInputs(variants: Array<{ platform_ids: string[]; region_id?: unknown; price_usd: number }>): VariantValidationError[] {
  const errors: VariantValidationError[] = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (!v.platform_ids?.length || v.platform_ids.some(pid => !isValidUuid(pid))) {
      errors.push({ index: i + 1, error: 'at least one valid platform UUID is required' });
    }
    const regionId = parseOptionalUuid(v.region_id);
    if (!regionId) {
      errors.push({ index: i + 1, error: 'region_id is required and must be a valid UUID' });
    }
    if (!isValidPriceCents(v.price_usd)) {
      errors.push({ index: i + 1, error: `price_usd must be 0-${MAX_PRICE_CENTS} (cents)` });
    }
  }
  return errors;
}
