/**
 * Tests for eneba-marketplace-financials helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  extractEnebaExtraInfoValue,
  buildMarketplaceFinancialsFromEnebaAuction,
  computeEnebaSellerNetCents,
} from '../src/core/use-cases/seller-webhook/eneba/eneba-marketplace-financials.js';
import type { EnebaCallbackAuction } from '../src/core/use-cases/seller-webhook/eneba/eneba-payload-parser.js';

// ─── extractEnebaExtraInfoValue ──────────────────────────────────────

describe('extractEnebaExtraInfoValue', () => {
  it('extracts buyerIp from a JSON-serialized array', () => {
    const extraInfo = JSON.stringify([{ name: 'buyerIp', value: '93.159.58.113' }]);
    expect(extractEnebaExtraInfoValue(extraInfo, 'buyerIp')).toBe('93.159.58.113');
  });

  it('returns null when the key is absent', () => {
    const extraInfo = JSON.stringify([{ name: 'otherKey', value: 'foo' }]);
    expect(extractEnebaExtraInfoValue(extraInfo, 'buyerIp')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractEnebaExtraInfoValue('', 'buyerIp')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(extractEnebaExtraInfoValue(null, 'buyerIp')).toBeNull();
    expect(extractEnebaExtraInfoValue(undefined, 'buyerIp')).toBeNull();
  });

  it('returns null for non-JSON string', () => {
    expect(extractEnebaExtraInfoValue('plain string', 'buyerIp')).toBeNull();
  });

  it('returns null when extraInfo is a JSON object (not array)', () => {
    const extraInfo = JSON.stringify({ name: 'buyerIp', value: '1.2.3.4' });
    expect(extractEnebaExtraInfoValue(extraInfo, 'buyerIp')).toBeNull();
  });

  it('handles multiple entries and returns the matching one', () => {
    const extraInfo = JSON.stringify([
      { name: 'country', value: 'DE' },
      { name: 'buyerIp', value: '10.0.0.1' },
    ]);
    expect(extractEnebaExtraInfoValue(extraInfo, 'buyerIp')).toBe('10.0.0.1');
    expect(extractEnebaExtraInfoValue(extraInfo, 'country')).toBe('DE');
  });
});

// ─── buildMarketplaceFinancialsFromEnebaAuction — buyer_ip ───────────

function makeAuction(overrides: Partial<EnebaCallbackAuction> = {}): EnebaCallbackAuction {
  return {
    auctionId: 'b1259882-4af3-11f1-8bc7-0e96fa65f949',
    keyCount: 1,
    price: { amount: '1632', currency: 'EUR' },
    originalPrice: { amount: '1518', currency: 'EUR' },
    priceWithoutCommission: { amount: '1509', currency: 'EUR' },
    campaignFee: { amount: '114', currency: 'EUR' },
    ...overrides,
  };
}

describe('buildMarketplaceFinancialsFromEnebaAuction', () => {
  it('populates buyer_ip from extraInfo array', () => {
    const auction = makeAuction({
      extraInfo: JSON.stringify([{ name: 'buyerIp', value: '93.159.58.113' }]),
    });
    const f = buildMarketplaceFinancialsFromEnebaAuction(auction, false);
    expect(f.buyer_ip).toBe('93.159.58.113');
  });

  it('buyer_ip is null when extraInfo has no buyerIp entry', () => {
    const auction = makeAuction({ extraInfo: undefined });
    const f = buildMarketplaceFinancialsFromEnebaAuction(auction, false);
    expect(f.buyer_ip).toBeNull();
  });

  it('builds correct financials from the actual RESERVE payload', () => {
    const auction = makeAuction({
      extraInfo: JSON.stringify([{ name: 'buyerIp', value: '93.159.58.113' }]),
    });
    const f = buildMarketplaceFinancialsFromEnebaAuction(auction, false);

    expect(f.gross_cents_per_unit).toBe(1632);
    expect(f.price_without_commission_cents_per_unit).toBe(1509);
    expect(f.campaign_fee_cents_per_unit).toBe(114);
    // seller_profit uses commission formula on originalPrice (1518), NOT pwc−campaignFee:
    // round(0.06 × 1518 + 25) = 116 → 1518 − 116 = 1402
    // Confirmed by S_calculatePrice API: priceWithoutCommission = 1402.
    expect(f.seller_profit_cents_per_unit).toBe(1402);
    expect(f.currency).toBe('EUR');
    expect(f.buyer_ip).toBe('93.159.58.113');
  });

  it('seller_profit falls back to pwc-campaignFee when originalPrice is absent', () => {
    const auction = makeAuction({ originalPrice: null });
    const f = buildMarketplaceFinancialsFromEnebaAuction(auction, false);
    // fallback: 1509 − 114 = 1395
    expect(f.seller_profit_cents_per_unit).toBe(1395);
  });

  it('seller_profit equals pwc when no campaign fee and originalPrice absent', () => {
    const auction = makeAuction({ originalPrice: null, campaignFee: null });
    const f = buildMarketplaceFinancialsFromEnebaAuction(auction, false);
    expect(f.seller_profit_cents_per_unit).toBe(1509);
  });
});

// ─── computeEnebaSellerNetCents ──────────────────────────────────────

describe('computeEnebaSellerNetCents', () => {
  it('applies 6% + €0.25 commission for items ≥ €5 (≥ 500 cents)', () => {
    // round(0.06 × 1518 + 25) = round(116.08) = 116 → 1518 − 116 = 1402
    // Confirmed by S_calculatePrice API response for the actual listing.
    expect(computeEnebaSellerNetCents(1518)).toBe(1402);
  });

  it('applies 6% + €0.25 at the boundary (500 cents = €5.00)', () => {
    // round(0.06 × 500 + 25) = round(55) = 55 → 500 − 55 = 445
    expect(computeEnebaSellerNetCents(500)).toBe(445);
  });

  it('applies 5% commission for items < €5 (< 500 cents)', () => {
    // round(0.05 × 193) = round(9.65) = 10 → 193 − 10 = 183
    // Confirmed by actual reservation data: gross 193, pwc 183.
    expect(computeEnebaSellerNetCents(193)).toBe(183);
  });

  it('applies 5% for items just under the boundary (499 cents)', () => {
    // round(0.05 × 499) = round(24.95) = 25 → 499 − 25 = 474
    expect(computeEnebaSellerNetCents(499)).toBe(474);
  });

  it('low-tier: gross 187 → net 178 (matches reservation data)', () => {
    // round(0.05 × 187) = round(9.35) = 9 → 187 − 9 = 178
    expect(computeEnebaSellerNetCents(187)).toBe(178);
  });

  it('low-tier: gross 183 → net 174 (matches reservation data)', () => {
    // round(0.05 × 183) = round(9.15) = 9 → 183 − 9 = 174
    expect(computeEnebaSellerNetCents(183)).toBe(174);
  });

  it('low-tier: gross 197 → net 187 (matches reservation data)', () => {
    // round(0.05 × 197) = round(9.85) = 10 → 197 − 10 = 187
    expect(computeEnebaSellerNetCents(197)).toBe(187);
  });
});
