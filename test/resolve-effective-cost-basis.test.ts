import { describe, expect, it } from 'vitest';
import { resolveEffectiveCostBasisCents } from '../src/core/use-cases/seller/resolve-effective-cost-basis.js';

describe('resolveEffectiveCostBasisCents', () => {
  it('returns the procurement override for declared_stock when provided', () => {
    const result = resolveEffectiveCostBasisCents({
      listingType: 'declared_stock',
      costCents: 800,
      procurementCostBasisCents: 1000,
    });
    expect(result).toBe(1000);
  });

  it('returns the listing cost basis for declared_stock when override is missing', () => {
    const result = resolveEffectiveCostBasisCents({
      listingType: 'declared_stock',
      costCents: 800,
    });
    expect(result).toBe(800);
  });

  it('ignores the override for key_upload listings', () => {
    const result = resolveEffectiveCostBasisCents({
      listingType: 'key_upload',
      costCents: 800,
      procurementCostBasisCents: 1000,
    });
    expect(result).toBe(800);
  });

  it('ignores zero / negative / non-finite overrides', () => {
    expect(
      resolveEffectiveCostBasisCents({
        listingType: 'declared_stock',
        costCents: 800,
        procurementCostBasisCents: 0,
      }),
    ).toBe(800);
    expect(
      resolveEffectiveCostBasisCents({
        listingType: 'declared_stock',
        costCents: 800,
        procurementCostBasisCents: -1,
      }),
    ).toBe(800);
    expect(
      resolveEffectiveCostBasisCents({
        listingType: 'declared_stock',
        costCents: 800,
        procurementCostBasisCents: Number.NaN,
      }),
    ).toBe(800);
    expect(
      resolveEffectiveCostBasisCents({
        listingType: 'declared_stock',
        costCents: 800,
        procurementCostBasisCents: Number.POSITIVE_INFINITY,
      }),
    ).toBe(800);
  });
});
