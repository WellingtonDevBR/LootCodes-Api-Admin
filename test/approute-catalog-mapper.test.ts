import { describe, expect, it } from 'vitest';
import {
  flattenAppRouteServicesToCatalogRows,
  appRouteDenominationToQuoteSnapshot,
} from '../src/infra/marketplace/approute/catalog-mapper.js';

describe('AppRoute catalog mapper', () => {
  it('flattens nested services into catalog upsert rows with denomination id as external_product_id', () => {
    const rows = flattenAppRouteServicesToCatalogRows(
      {
        items: [
          {
            id: 'svc-1',
            name: 'Steam',
            type: 'voucher',
            items: [
              {
                id: 'den-a',
                name: '$10',
                price: 9.99,
                currency: 'usd',
                countryCode: 'US',
                inStock: true,
              },
            ],
          },
        ],
      },
      'approute',
      'acct-1',
      '2026-05-07T12:00:00.000Z',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.external_product_id).toBe('den-a');
    expect(rows[0]?.external_parent_product_id).toBe('svc-1');
    expect(rows[0]?.provider_account_id).toBe('acct-1');
    expect(rows[0]?.provider_code).toBe('approute');
    expect(rows[0]?.slug).toBe('svc-1');
    expect(rows[0]?.min_price_cents).toBe(999);
    expect(rows[0]?.currency).toBe('USD');
    expect(rows[0]?.available_to_buy).toBe(true);
    expect(rows[0]?.product_name).toMatch(/Steam/);
    expect(rows[0]?.product_name).toMatch(/\$10|10/);
    const raw = rows[0]?.raw_data as Record<string, unknown> | undefined;
    expect(raw?.serviceId).toBe('svc-1');
  });

  it('maps numeric inStock to qty when supplier sends counts', () => {
    const rows = flattenAppRouteServicesToCatalogRows(
      {
        items: [
          {
            id: 'svc-adobe',
            name: 'Adobe Digital Code',
            type: 'voucher',
            countryCode: 'MENA',
            items: [
              {
                id: '1e5ff58d-ccd5-4c38-9ddf-b7ebf01b3709',
                name: 'Adobe Acrobat AI Assistant: 1 Year',
                price: 53.2213,
                currency: 'USD',
                inStock: 500,
              },
            ],
          },
        ],
      },
      'approute',
      'acct-1',
      '2026-05-08T12:00:00.000Z',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.qty).toBe(500);
    expect(rows[0]?.external_parent_product_id).toBe('svc-adobe');
    expect(rows[0]?.available_to_buy).toBe(true);
    expect(rows[0]?.min_price_cents).toBe(5322);
    expect(rows[0]?.region).toBe('MENA');
    expect(String(rows[0]?.product_name)).toContain('(MENA)');
  });

  it('falls back to service.countryCode when denomination omits countryCode', () => {
    const rows = flattenAppRouteServicesToCatalogRows(
      {
        items: [
          {
            id: 'svc-x',
            name: 'Group',
            countryCode: 'GLOBAL',
            items: [{ id: 'd1', name: 'SKU', price: 1, currency: 'USD', inStock: true }],
          },
        ],
      },
      'approute',
      'acct',
      '2026-05-08T12:00:00.000Z',
    );
    expect(rows[0]?.region).toBe('GLOBAL');
  });

  it('marks unavailable when numeric inStock is zero', () => {
    const rows = flattenAppRouteServicesToCatalogRows(
      {
        items: [
          {
            id: 'svc',
            items: [{ id: 'den-z', price: 10, currency: 'USD', inStock: 0 }],
          },
        ],
      },
      'approute',
      'acct',
      '2026-05-08T12:00:00.000Z',
    );
    expect(rows[0]?.qty).toBe(0);
    expect(rows[0]?.available_to_buy).toBe(false);
  });

  it('marks unavailable denominations when inStock is false', () => {
    const rows = flattenAppRouteServicesToCatalogRows(
      {
        items: [
          {
            id: 'svc',
            items: [{ id: 'd1', price: 1, inStock: false }],
          },
        ],
      },
      'approute',
      'acct',
      '2026-05-07T12:00:00.000Z',
    );
    expect(rows[0]?.available_to_buy).toBe(false);
    expect(rows[0]?.qty).toBe(0);
  });
});

describe('appRouteDenominationToQuoteSnapshot', () => {
  it('maps denomination fields for procurement snapshots', () => {
    expect(
      appRouteDenominationToQuoteSnapshot({
        id: 'den-w',
        name: '$10',
        price: 10.556,
        currency: 'usd',
        inStock: 42,
      }),
    ).toEqual({
      price_cents: 1056,
      available_quantity: 42,
      currency: 'USD',
    });
  });
});
