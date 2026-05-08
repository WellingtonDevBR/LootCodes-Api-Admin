/**
 * Tests for eneba-marketplace-financials helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  extractEnebaExtraInfoValue,
  buildMarketplaceFinancialsFromEnebaAuction,
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
    // seller_profit = priceWithoutCommission - campaignFee
    expect(f.seller_profit_cents_per_unit).toBe(1509 - 114);
    expect(f.currency).toBe('EUR');
    expect(f.buyer_ip).toBe('93.159.58.113');
  });
});
