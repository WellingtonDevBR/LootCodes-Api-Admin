import { describe, expect, it } from 'vitest';
import { coerceProcurementAvailableQuantity } from '../src/infra/seller/load-procurement-offer-supply.js';

describe('coerceProcurementAvailableQuantity', () => {
  it('returns null for empty unknown shapes', () => {
    expect(coerceProcurementAvailableQuantity(undefined)).toBeNull();
    expect(coerceProcurementAvailableQuantity(null)).toBeNull();
    expect(coerceProcurementAvailableQuantity('')).toBeNull();
    expect(coerceProcurementAvailableQuantity('   ')).toBeNull();
    expect(coerceProcurementAvailableQuantity(NaN)).toBeNull();
    expect(coerceProcurementAvailableQuantity({})).toBeNull();
  });

  it('truncates finite numbers and numeric strings', () => {
    expect(coerceProcurementAvailableQuantity(12)).toBe(12);
    expect(coerceProcurementAvailableQuantity(12.7)).toBe(12);
    expect(coerceProcurementAvailableQuantity('42')).toBe(42);
    expect(coerceProcurementAvailableQuantity(' 99 ')).toBe(99);
  });
});
