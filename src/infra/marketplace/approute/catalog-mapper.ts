import { floatToCents } from '../../../shared/pricing.js';
import type { AppRouteServiceDenomination, AppRouteServicesData } from './types.js';

function buildProductName(serviceName?: string, denomName?: string, country?: string): string {
  const a = (serviceName ?? '').trim();
  const b = (denomName ?? '').trim();
  const core = a && b ? `${a} — ${b}` : a || b || 'Product';
  const cc = (country ?? '').trim();
  return cc ? `${core} (${cc})` : core;
}

function majorUnitsToCents(price: unknown): number {
  if (typeof price === 'number' && Number.isFinite(price)) {
    return floatToCents(price);
  }
  if (typeof price === 'string') {
    const n = Number.parseFloat(price.trim());
    return Number.isFinite(n) ? floatToCents(n) : 0;
  }
  return 0;
}

function normalizeCurrency(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return 'USD';
  return raw.trim().toUpperCase().slice(0, 3);
}

/** AppRoute sends `inStock` as boolean or stock count; normalize for `qty` / `available_to_buy`. */
function resolveQtyAndAvailability(denom: AppRouteServiceDenomination): {
  readonly qty: number;
  readonly available: boolean;
} {
  const raw = denom.inStock;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const q = Math.max(0, Math.floor(raw));
    return { qty: q, available: q > 0 };
  }
  if (typeof raw === 'boolean') {
    return raw ? { qty: 1, available: true } : { qty: 0, available: false };
  }
  if (typeof denom.quantity === 'number' && denom.quantity >= 0) {
    const q = Math.floor(denom.quantity);
    return { qty: q, available: q > 0 };
  }
  return { qty: 1, available: true };
}

/** Maps GET /services payload into `provider_product_catalog` upsert rows. */
export function flattenAppRouteServicesToCatalogRows(
  data: AppRouteServicesData,
  providerCode: string,
  providerAccountId: string,
  updatedAtIso: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const service of data.items ?? []) {
    const parentId = String(service.id);
    const serviceCountry = (service.countryCode ?? '').trim();
    for (const denom of service.items ?? []) {
      const externalId = String(denom.id);
      const cents = majorUnitsToCents(denom.price);
      const currency = normalizeCurrency(denom.currency);
      const { qty, available } = resolveQtyAndAvailability(denom);
      const denomCountry = (denom.countryCode ?? '').trim();
      const regionLabel = denomCountry || serviceCountry || undefined;

      rows.push({
        provider_account_id: providerAccountId,
        provider_code: providerCode,
        external_product_id: externalId,
        external_parent_product_id: parentId,
        product_name: buildProductName(service.name, denom.name, regionLabel),
        platform: null,
        region: regionLabel ?? null,
        min_price_cents: cents,
        currency,
        qty,
        available_to_buy: available,
        thumbnail: null,
        slug: parentId,
        developer: null,
        publisher: null,
        release_date: null,
        wholesale_price_cents: null,
        updated_at: updatedAtIso,
        raw_data: {
          serviceId: parentId,
          serviceName: service.name,
          serviceType: service.type,
          serviceFields: service.fields,
          denomination: denom,
        },
      });
    }
  }

  return rows;
}

/** Maps one denomination from GET /services/{serviceId} for procurement offer snapshots. */
export function appRouteDenominationToQuoteSnapshot(denom: AppRouteServiceDenomination): {
  price_cents: number;
  available_quantity: number;
  currency: string;
} {
  const cents = majorUnitsToCents(denom.price);
  const currency = normalizeCurrency(denom.currency);
  const { qty } = resolveQtyAndAvailability(denom);
  return { price_cents: cents, available_quantity: qty, currency };
}
