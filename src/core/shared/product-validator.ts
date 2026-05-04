const VALID_PRODUCT_TYPES = ['key', 'account', 'gift_card', 'subscription', 'dlc', 'software'] as const;
const VALID_DELIVERY_TYPES = ['instant', 'manual', 'pre_order'] as const;
const VALID_CATEGORIES = ['games', 'software', 'gift_cards', 'subscriptions', 'dlc', 'other'] as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PRICE_CENTS = 99999999;

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

export function validateVariantInputs(variants: Array<{ platform_ids: string[]; region_id?: string; price_usd: number }>): VariantValidationError[] {
  const errors: VariantValidationError[] = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (!v.platform_ids?.length || v.platform_ids.some(pid => !isValidUuid(pid))) {
      errors.push({ index: i + 1, error: 'at least one valid platform UUID is required' });
    }
    if (v.region_id && !isValidUuid(v.region_id)) {
      errors.push({ index: i + 1, error: 'region_id must be a valid UUID' });
    }
    if (!isValidPriceCents(v.price_usd)) {
      errors.push({ index: i + 1, error: `price_usd must be 0-${MAX_PRICE_CENTS} (cents)` });
    }
  }
  return errors;
}
