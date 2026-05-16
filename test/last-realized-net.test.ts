/**
 * Unit tests for the realised-net feedback helpers in
 * `core/shared/last-realized-net.ts`.
 *
 * The helpers are pure (no DB, no FX, no clock injection) — these tests
 * exercise every branch deterministically with frozen `Date.now`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  readLastRealizedNet,
  pessimisticSaleCents,
  withLastRealizedNet,
} from '../src/core/shared/last-realized-net.js';

const FROZEN_NOW = new Date('2026-05-16T12:00:00Z').getTime();

describe('readLastRealizedNet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when metadata is missing', () => {
    expect(readLastRealizedNet(null)).toBeNull();
    expect(readLastRealizedNet(undefined)).toBeNull();
    expect(readLastRealizedNet({})).toBeNull();
  });

  it('returns null when key is absent or shaped wrong', () => {
    expect(readLastRealizedNet({ lastRealizedNet: 'not-an-object' })).toBeNull();
    expect(readLastRealizedNet({ lastRealizedNet: null })).toBeNull();
    expect(readLastRealizedNet({ lastRealizedNet: { centsPerUnit: '1500' } })).toBeNull();
    expect(readLastRealizedNet({ lastRealizedNet: { centsPerUnit: 0, currency: 'USD', at: '2026-05-15' } })).toBeNull();
    expect(readLastRealizedNet({ lastRealizedNet: { centsPerUnit: 1500, currency: '', at: '2026-05-15' } })).toBeNull();
  });

  it('returns the value when fresh and well-shaped', () => {
    const at = new Date(FROZEN_NOW - 60_000).toISOString();
    const out = readLastRealizedNet({
      lastRealizedNet: { centsPerUnit: 1373, currency: 'EUR', at },
    });
    expect(out).toEqual({ centsPerUnit: 1373, currency: 'EUR', at });
  });

  it('returns null for stale records older than 7 days', () => {
    const eightDaysAgo = new Date(FROZEN_NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
    const out = readLastRealizedNet({
      lastRealizedNet: { centsPerUnit: 1373, currency: 'EUR', at: eightDaysAgo },
    });
    expect(out).toBeNull();
  });

  it('returns null when the timestamp cannot be parsed', () => {
    const out = readLastRealizedNet({
      lastRealizedNet: { centsPerUnit: 1373, currency: 'EUR', at: 'not-a-date' },
    });
    expect(out).toBeNull();
  });
});

describe('pessimisticSaleCents', () => {
  it('returns intended price when no realised observation exists', () => {
    expect(pessimisticSaleCents(1500, 'USD', null)).toBe(1500);
  });

  it('returns the lower of (intended, realised) when currencies match', () => {
    const realised = { centsPerUnit: 1373, currency: 'EUR', at: new Date().toISOString() };
    expect(pessimisticSaleCents(1500, 'EUR', realised)).toBe(1373);
    expect(pessimisticSaleCents(1300, 'EUR', realised)).toBe(1300);
  });

  it('handles case-insensitive currency comparison', () => {
    const realised = { centsPerUnit: 1373, currency: 'eur', at: new Date().toISOString() };
    expect(pessimisticSaleCents(1500, 'EUR', realised)).toBe(1373);
  });

  it('falls back to intended price when currencies differ (no cross-FX)', () => {
    const realised = { centsPerUnit: 1373, currency: 'EUR', at: new Date().toISOString() };
    expect(pessimisticSaleCents(1500, 'USD', realised)).toBe(1500);
  });
});

describe('withLastRealizedNet', () => {
  it('overlays the new value while preserving other metadata keys', () => {
    const existing = { healthMetrics: { out_of_stock_consecutive_failures: 3 } };
    const out = withLastRealizedNet(existing, {
      centsPerUnit: 1373,
      currency: 'EUR',
      at: '2026-05-16T12:00:00Z',
    });
    expect(out).toEqual({
      healthMetrics: { out_of_stock_consecutive_failures: 3 },
      lastRealizedNet: { centsPerUnit: 1373, currency: 'EUR', at: '2026-05-16T12:00:00Z' },
    });
  });

  it('starts from an empty object when no existing metadata', () => {
    const out = withLastRealizedNet(null, {
      centsPerUnit: 1373,
      currency: 'EUR',
      at: '2026-05-16T12:00:00Z',
    });
    expect(out).toEqual({
      lastRealizedNet: { centsPerUnit: 1373, currency: 'EUR', at: '2026-05-16T12:00:00Z' },
    });
  });

  it('replaces an existing lastRealizedNet rather than merging it', () => {
    const existing = {
      lastRealizedNet: { centsPerUnit: 9999, currency: 'XXX', at: '2020-01-01T00:00:00Z' },
    };
    const out = withLastRealizedNet(existing, {
      centsPerUnit: 1373,
      currency: 'EUR',
      at: '2026-05-16T12:00:00Z',
    });
    expect(out.lastRealizedNet).toEqual({
      centsPerUnit: 1373,
      currency: 'EUR',
      at: '2026-05-16T12:00:00Z',
    });
  });
});
