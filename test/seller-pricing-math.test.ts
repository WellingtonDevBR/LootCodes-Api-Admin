import { describe, expect, it } from 'vitest';
import {
  computeUndampenedOptimalTarget,
  computeProfitabilityFloorCents,
} from '../src/infra/seller/pricing/seller-pricing-math.js';
import type { CompetitorPrice } from '../src/core/ports/marketplace-adapter.port.js';

function comp(priceCents: number, isOwn = false, merchantName?: string): CompetitorPrice {
  return { priceCents, inStock: true, isOwnOffer: isOwn, merchantName: merchantName ?? '' };
}

const NO_FLOOR = { floor_price_cents: null };
const config = { max_position_target: 2, position_gap_threshold_pct: 10 };

describe('computeUndampenedOptimalTarget', () => {
  describe('normal operation — P1 above floor', () => {
    it('undercuts P1 by 1 cent when gap is small', () => {
      const result = computeUndampenedOptimalTarget(
        [comp(1600), comp(1650)],
        NO_FLOOR, 1400, config,
      );
      expect(result?.targetPrice).toBe(1599);
      expect(result?.reasonCode).toBe('standard_undercut');
    });

    it('exploits the gap and targets P2−1 when gap > threshold', () => {
      // P1=1600 P2=1800 gap=12.5% > 10%
      const result = computeUndampenedOptimalTarget(
        [comp(1600), comp(1800)],
        NO_FLOOR, 1400, config,
      );
      expect(result?.targetPrice).toBe(1799);
      expect(result?.reasonCode).toBe('gap_exploit');
    });
  });

  describe('gap_above_floor — P1 below profitability floor', () => {
    it('targets 1 cent below the first competitor above the floor (Minecraft scenario)', () => {
      // floor=1530, competitors=[1509,1512,1517,1520,1545,1557,1572]
      // P1=1509 < floor → firstAboveFloor=1545 → target=1544
      const competitors = [
        comp(1509), comp(1509), comp(1509),
        comp(1512), comp(1517), comp(1520),
        comp(1545), comp(1557), comp(1572),
      ];
      const result = computeUndampenedOptimalTarget(
        competitors, NO_FLOOR, 1530, config,
      );
      expect(result?.targetPrice).toBe(1544);
      expect(result?.reasonCode).toBe('gap_above_floor');
    });

    it('falls back to floor when no competitor is above it', () => {
      // All competitors below floor — sit at floor
      const competitors = [comp(1400), comp(1450), comp(1500)];
      const result = computeUndampenedOptimalTarget(
        competitors, NO_FLOOR, 1600, config,
      );
      expect(result?.targetPrice).toBe(1600);
    });

    it('stays at floor when firstAboveFloor is exactly floor+1 (no gap to exploit)', () => {
      // firstAboveFloor = 1531, floor = 1530 → gapTarget = 1530 = floor (not > floor)
      const competitors = [comp(1400), comp(1531)];
      const result = computeUndampenedOptimalTarget(
        competitors, NO_FLOOR, 1530, config,
      );
      expect(result?.targetPrice).toBe(1530);
    });

    it('returns null when there are no non-own competitors', () => {
      const result = computeUndampenedOptimalTarget(
        [comp(1600, true)], NO_FLOOR, 1400, config,
      );
      expect(result).toBeNull();
    });
  });

  describe('excluded_p1_merchants — SharpGames rule', () => {
    const cfgExclude = {
      max_position_target: 2,
      position_gap_threshold_pct: 10,
      excluded_p1_merchants: ['SharpGames'],
    };

    it('skips P1 (SharpGames) and undercuts P2 when P2 exists', () => {
      // SharpGames@1500, next-best@1600 → target = 1599 (undercut P2 which becomes new P1)
      const result = computeUndampenedOptimalTarget(
        [comp(1500, false, 'SharpGames'), comp(1600, false, 'OtherShop')],
        NO_FLOOR, 1400, cfgExclude,
      );
      expect(result?.targetPrice).toBe(1599);
    });

    it('returns null (hold price) when SharpGames is the only competitor', () => {
      const result = computeUndampenedOptimalTarget(
        [comp(1500, false, 'SharpGames')],
        NO_FLOOR, 1400, cfgExclude,
      );
      expect(result).toBeNull();
    });

    it('competes normally when SharpGames is NOT at P1', () => {
      // OtherShop@1500 (P1), SharpGames@1600 (P2) → undercut P1 normally
      const result = computeUndampenedOptimalTarget(
        [comp(1500, false, 'OtherShop'), comp(1600, false, 'SharpGames')],
        NO_FLOOR, 1400, cfgExclude,
      );
      expect(result?.targetPrice).toBe(1499);
    });

    it('is case-insensitive — "sharpgames" in config matches "SharpGames" in data', () => {
      const cfgLower = { ...cfgExclude, excluded_p1_merchants: ['sharpgames'] };
      const result = computeUndampenedOptimalTarget(
        [comp(1500, false, 'SharpGames'), comp(1600, false, 'OtherShop')],
        NO_FLOOR, 1400, cfgLower,
      );
      expect(result?.targetPrice).toBe(1599);
    });

    it('still applies floor when P2 is below profitability floor', () => {
      // SharpGames@1400 excluded, OtherShop@1420 < floor 1500 → fallback at floor
      const result = computeUndampenedOptimalTarget(
        [comp(1400, false, 'SharpGames'), comp(1420, false, 'OtherShop')],
        NO_FLOOR, 1500, cfgExclude,
      );
      expect(result?.targetPrice).toBe(1500);
    });

    it('no-op when excluded_p1_merchants is empty (default behaviour unchanged)', () => {
      const result = computeUndampenedOptimalTarget(
        [comp(1500, false, 'SharpGames'), comp(1600, false, 'OtherShop')],
        NO_FLOOR, 1400, config,
      );
      // With no exclusion config, SharpGames is P1 → undercut to 1499
      expect(result?.targetPrice).toBe(1499);
    });
  });

  describe('computeProfitabilityFloorCents', () => {
    it('returns correct floor for NET pricing model (commission=0, fee=0)', () => {
      // cost=1399, margin=1%, no commission, no fee → ceil(1399*1.01) = 1413
      expect(computeProfitabilityFloorCents(1399, 0, 1, 0)).toBe(1413);
    });

    it('returns correct floor for GROSS model with commission and fixed fee', () => {
      // cost=1399, commission=6%, margin=1%, fixedFee=25
      // floor = ceil((1399*1.01 + 25) / 0.94) = ceil(1438.99/0.94) = ceil(1530.84) = 1530 (ceil of float)
      expect(computeProfitabilityFloorCents(1399, 6, 1, 25)).toBe(1530);
    });
  });
});
