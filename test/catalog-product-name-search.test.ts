import { describe, expect, it } from 'vitest';
import { catalogProductNameIlikeClauses } from '../src/infra/procurement/catalog-product-name-search.js';

describe('catalogProductNameIlikeClauses', () => {
  it('returns empty array when search is blank', () => {
    expect(catalogProductNameIlikeClauses(undefined)).toEqual([]);
    expect(catalogProductNameIlikeClauses('   ')).toEqual([]);
  });

  it('returns one ILIKE clause per whitespace-separated token', () => {
    expect(catalogProductNameIlikeClauses('Minecraft Java')).toEqual([
      ['product_name', '%Minecraft%'],
      ['product_name', '%Java%'],
    ]);
  });

  it('trims outer whitespace', () => {
    expect(catalogProductNameIlikeClauses('  steam  gift  ')).toEqual([
      ['product_name', '%steam%'],
      ['product_name', '%gift%'],
    ]);
  });
});
