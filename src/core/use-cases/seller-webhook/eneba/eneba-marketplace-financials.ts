/**
 * Eneba declared-stock marketplace financials parsing.
 *
 * Port of Edge Function `provider-procurement/providers/eneba/callback-pricing.ts`.
 *
 * Wire format: integer-only strings are already in smallest currency unit (cents).
 * Strings with `.` or `,` are parsed as major units and scaled by ISO 4217 minor digits.
 */
import type { EnebaCallbackAuction, EnebaCallbackMoney } from './eneba-payload-parser.js';
import type {
  MarketplaceFinancialsSnapshot,
  MarketplaceFinancialsRawWire,
} from '../seller-webhook.types.js';

// ─── ISO 4217 minor-unit exponent ────────────────────────────────────

function minorUnitExponent(currencyCode: string): number {
  const c = currencyCode.trim().toUpperCase();
  const zeroDecimal = new Set([
    'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
    'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
  ]);
  const threeDecimal = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
  if (zeroDecimal.has(c)) return 0;
  if (threeDecimal.has(c)) return 3;
  return 2;
}

// ─── Wire-amount parsing ─────────────────────────────────────────────

function wireAmountToString(amount: string | number): string {
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) return '';
    return String(amount);
  }
  return String(amount).trim();
}

interface ParsedMoney {
  cents: number;
  currency: string;
  rawAmount: string;
}

/**
 * Parse Eneba declared-stock money fields.
 * Integer-only strings = already minor units (cents).
 * Strings with decimal separators = major units, scaled by ISO 4217 exponent.
 */
export function parseEnebaDeclaredStockMoneyField(
  raw: EnebaCallbackMoney,
): ParsedMoney | null {
  const currency = String(raw.currency ?? '').trim();
  if (!currency) return null;

  const rawAmount = wireAmountToString(raw.amount);
  if (!rawAmount) return null;

  const trimmed = rawAmount.trim();
  const integerOnly = /^\d+$/.test(trimmed);

  if (integerOnly) {
    const cents = parseInt(trimmed, 10);
    if (!Number.isFinite(cents)) return null;
    return { cents, currency, rawAmount };
  }

  const normalized = trimmed.replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;

  const exp = minorUnitExponent(currency);
  const cents = Math.round(n * 10 ** exp);
  return { cents, currency, rawAmount };
}

// ─── Financials snapshot builder ─────────────────────────────────────

export function buildMarketplaceFinancialsFromEnebaAuction(
  auction: EnebaCallbackAuction,
  wholesale: boolean,
): MarketplaceFinancialsSnapshot {
  const gross = parseEnebaDeclaredStockMoneyField(auction.price);
  if (!gross) {
    throw new Error('Invalid auction price for marketplace financials');
  }

  const keyCount = auction.keyCount;

  const originalParsed = auction.originalPrice
    ? parseEnebaDeclaredStockMoneyField(auction.originalPrice)
    : null;
  const pwcParsed = auction.priceWithoutCommission
    ? parseEnebaDeclaredStockMoneyField(auction.priceWithoutCommission)
    : null;
  const campaignParsed = auction.campaignFee
    ? parseEnebaDeclaredStockMoneyField(auction.campaignFee)
    : null;
  const subFeeParsed = auction.substituteAuctionFee
    ? parseEnebaDeclaredStockMoneyField(auction.substituteAuctionFee)
    : null;

  const grossCentsPerUnit = gross.cents;
  const currency = gross.currency;

  const pwcCentsPerUnit = pwcParsed?.cents ?? grossCentsPerUnit;
  const campaignCentsPerUnit = campaignParsed?.cents ?? 0;
  const sellerProfitCentsPerUnit = pwcCentsPerUnit - campaignCentsPerUnit;

  const totalGrossCents = grossCentsPerUnit * keyCount;
  const totalSellerProfitCents = sellerProfitCentsPerUnit * keyCount;
  const totalProviderFeeAggregateCents = totalGrossCents - totalSellerProfitCents;

  const raw: MarketplaceFinancialsRawWire = {
    price_amount: gross.rawAmount,
    price_currency: gross.currency,
  };
  if (originalParsed) {
    raw.original_price_amount = originalParsed.rawAmount;
    raw.original_price_currency = originalParsed.currency;
  }
  if (pwcParsed) {
    raw.price_without_commission_amount = pwcParsed.rawAmount;
    raw.price_without_commission_currency = pwcParsed.currency;
  }
  if (campaignParsed) {
    raw.campaign_fee_amount = campaignParsed.rawAmount;
    raw.campaign_fee_currency = campaignParsed.currency;
  }
  if (subFeeParsed) {
    raw.substitute_auction_fee_amount = subFeeParsed.rawAmount;
    raw.substitute_auction_fee_currency = subFeeParsed.currency;
  }

  return {
    provider: 'eneba',
    wholesale,
    currency,
    key_count: keyCount,
    gross_cents_per_unit: grossCentsPerUnit,
    original_price_cents_per_unit: originalParsed?.cents ?? null,
    price_without_commission_cents_per_unit: pwcCentsPerUnit,
    campaign_fee_cents_per_unit: campaignCentsPerUnit,
    substitute_auction_fee_cents_per_unit: subFeeParsed?.cents ?? null,
    seller_profit_cents_per_unit: sellerProfitCentsPerUnit,
    extra_info: auction.extraInfo != null && auction.extraInfo !== '' ? String(auction.extraInfo) : null,
    total_gross_cents: totalGrossCents,
    total_seller_profit_cents: totalSellerProfitCents,
    total_provider_fee_aggregate_cents: totalProviderFeeAggregateCents,
    raw,
  };
}

/**
 * Compute the aggregate fees in cents across all auctions.
 * Used to set the JIT `max_cost_cents` ceiling.
 */
export function computeAggregateFeesCents(
  auctions: EnebaCallbackAuction[],
  wholesale: boolean,
): number {
  let totalFees = 0;
  for (const auction of auctions) {
    try {
      const financials = buildMarketplaceFinancialsFromEnebaAuction(auction, wholesale);
      totalFees += financials.total_provider_fee_aggregate_cents;
    } catch {
      /* skip auctions with unparseable prices */
    }
  }
  return totalFees;
}
