import { describe, expect, it } from 'vitest';
import {
  normalizeBambooWalletCurrency,
  parseBambooAccountsResponse,
  resolveBambooCheckoutAccountId,
} from '../src/infra/procurement/bamboo-resolve-checkout-account.js';

describe('normalizeBambooWalletCurrency', () => {
  it('defaults invalid codes to USD', () => {
    expect(normalizeBambooWalletCurrency('')).toBe('USD');
    expect(normalizeBambooWalletCurrency('TOOLONG')).toBe('USD');
    expect(normalizeBambooWalletCurrency('12')).toBe('USD');
  });

  it('uppercases valid ISO codes', () => {
    expect(normalizeBambooWalletCurrency('usd')).toBe('USD');
    expect(normalizeBambooWalletCurrency('EUR')).toBe('EUR');
  });
});

describe('parseBambooAccountsResponse', () => {
  it('parses camelCase Bamboo payloads', () => {
    const accounts = parseBambooAccountsResponse({
      accounts: [
        { id: 1, currency: 'USD', balance: 10, isActive: true, sandboxMode: true },
        { id: 2, currency: 'USD', balance: 20, isActive: true, sandboxMode: false },
      ],
    });
    expect(accounts).toHaveLength(2);
    expect(accounts[1]?.sandboxMode).toBe(false);
  });

  it('parses PascalCase Bamboo payloads', () => {
    const accounts = parseBambooAccountsResponse({
      Accounts: [
        { Id: 99, Currency: 'EUR', Balance: 5.5, IsActive: true, SandboxMode: false },
      ],
    });
    expect(accounts).toEqual([
      expect.objectContaining({
        id: 99,
        currency: 'EUR',
        balance: 5.5,
        isActive: true,
        sandboxMode: false,
      }),
    ]);
  });

  it('returns empty array for invalid bodies', () => {
    expect(parseBambooAccountsResponse(null)).toEqual([]);
    expect(parseBambooAccountsResponse({})).toEqual([]);
    expect(parseBambooAccountsResponse({ accounts: 'no' })).toEqual([]);
  });
});

describe('resolveBambooCheckoutAccountId', () => {
  const usd2566 = {
    id: 2566,
    currency: 'USD',
    balance: 100,
    isActive: true,
    sandboxMode: false,
  };
  const usd2565 = {
    id: 2565,
    currency: 'USD',
    balance: 50,
    isActive: true,
    sandboxMode: false,
  };
  const eur2612 = {
    id: 2612,
    currency: 'EUR',
    balance: 40,
    isActive: true,
    sandboxMode: false,
  };

  it('uses configured account when it matches preferred currency and is live', () => {
    const r = resolveBambooCheckoutAccountId(
      2566,
      [usd2565, usd2566, eur2612],
      'USD',
    );
    expect(r).toEqual({ ok: true, accountId: 2566 });
  });

  it('selects sole USD wallet when configured id is invalid', () => {
    const r = resolveBambooCheckoutAccountId(
      99999,
      [usd2565, eur2612],
      'USD',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accountId).toBe(2565);
  });

  it('selects sole EUR wallet independently', () => {
    const r = resolveBambooCheckoutAccountId(1, [usd2565, eur2612], 'EUR');
    expect(r).toEqual(expect.objectContaining({ ok: true, accountId: 2612 }));
  });

  it('rejects multiple wallets in the same currency without a matching configured id', () => {
    const r = resolveBambooCheckoutAccountId(
      99999,
      [usd2565, usd2566, eur2612],
      'USD',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error_message).toMatch(/Multiple live Bamboo USD wallets/);
      expect(r.error_message).toContain('2565');
      expect(r.error_message).toContain('2566');
    }
  });

  it('rejects configured live wallet when currency mismatches purchase currency', () => {
    const r = resolveBambooCheckoutAccountId(2612, [usd2565, eur2612], 'USD');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error_message).toMatch(/2612.*EUR.*USD/s);
    }
  });

  it('replaces sandbox configured id with sole live wallet in that currency', () => {
    const r = resolveBambooCheckoutAccountId(
      2566,
      [
        { id: 2566, currency: 'USD', balance: 0, isActive: true, sandboxMode: true },
        usd2565,
        eur2612,
      ],
      'USD',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.accountId).toBe(2565);
      expect(r.resolutionNote).toMatch(/sandbox account.*2565/s);
    }
  });

  it('rejects sandbox configured id when multiple live USD wallets exist', () => {
    const r = resolveBambooCheckoutAccountId(
      2566,
      [
        { id: 2566, currency: 'USD', balance: 0, isActive: true, sandboxMode: true },
        usd2565,
        usd2566,
      ],
      'USD',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error_message).toMatch(/Multiple live Bamboo USD wallets/);
  });

  it('rejects when no live wallet exists for requested currency', () => {
    const r = resolveBambooCheckoutAccountId(1, [eur2612], 'USD');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error_message).toMatch(/No active live Bamboo USD wallet/);
  });
});
