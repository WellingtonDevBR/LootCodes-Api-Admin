import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { UC_TOKENS } from '../../../src/di/tokens.js';
import { buildTestApp, type TestApp } from '../../helpers/test-app.js';
import type {
  ReconcileSellerListingsDto,
  ReconcileSellerListingsResult,
  ReconcilePhase,
} from '../../../src/core/use-cases/seller/reconcile-seller-listings.types.js';

const VALID_SECRET = 'test-internal-secret';
const VARIANT_UUID = '11111111-1111-1111-1111-111111111111';

interface MockOrchestrator {
  execute: ReturnType<typeof vi.fn>;
}

function makeOrchestratorResult(
  overrides: Partial<ReconcileSellerListingsResult> = {},
): ReconcileSellerListingsResult {
  const phases = {
    'expire-reservations': { ran: true, duration_ms: 1, result: { expired: 0 } },
    'cost-basis': { ran: true, duration_ms: 1 },
    'pricing': { ran: true, duration_ms: 1 },
    'declared-stock': { ran: true, duration_ms: 1 },
    'remote-stock': { ran: true, duration_ms: 1 },
  } as Record<ReconcilePhase, { ran: boolean; duration_ms: number; result?: unknown }>;

  return {
    request_id: 'cron-req',
    fulfillment_mode: 'auto',
    total_duration_ms: 5,
    phases,
    ...overrides,
  } as ReconcileSellerListingsResult;
}

describe('Internal cron routes — POST /internal/cron/reconcile-seller-listings', () => {
  let testApp: TestApp;
  let orchestrator: MockOrchestrator;

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_SECRET = VALID_SECRET;
    process.env.PROCUREMENT_DECLARED_STOCK_CRON_SECRET = '';

    orchestrator = { execute: vi.fn() };
    container.register(UC_TOKENS.ReconcileSellerListings, { useValue: orchestrator });

    testApp = await buildTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(() => {
    orchestrator.execute.mockReset();
    orchestrator.execute.mockResolvedValue(makeOrchestratorResult());
  });

  describe('auth', () => {
    it('returns 401 without x-internal-secret header', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-seller-listings',
        payload: {},
      });
      expect(res.statusCode).toBe(401);
      expect(orchestrator.execute).not.toHaveBeenCalled();
    });

    it('returns 401 with an incorrect x-internal-secret', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-seller-listings',
        headers: { 'x-internal-secret': 'wrong' },
        payload: {},
      });
      expect(res.statusCode).toBe(401);
      expect(orchestrator.execute).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('returns 200 and the orchestrator result for an empty body', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-seller-listings',
        headers: { 'x-internal-secret': VALID_SECRET },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(orchestrator.execute).toHaveBeenCalledTimes(1);
      const body = res.json();
      expect(body.fulfillment_mode).toBe('auto');
      expect(body.phases['pricing'].ran).toBe(true);
    });

    it('forwards variant_ids, batch_limit, dry_run, and phases to the orchestrator', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-seller-listings',
        headers: { 'x-internal-secret': VALID_SECRET },
        payload: {
          variant_ids: [VARIANT_UUID],
          batch_limit: 25,
          dry_run: true,
          phases: ['cost-basis', 'pricing'],
        },
      });

      expect(res.statusCode).toBe(200);
      const dto = orchestrator.execute.mock.calls[0]![1] as ReconcileSellerListingsDto;
      expect(dto.variant_ids).toEqual([VARIANT_UUID]);
      expect(dto.batch_limit).toBe(25);
      expect(dto.dry_run).toBe(true);
      expect(dto.phases).toEqual(['cost-basis', 'pricing']);
    });
  });

  describe('strict input validation', () => {
    it('returns 400 when variant_ids contains a non-UUID entry (no silent drop)', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-seller-listings',
        headers: { 'x-internal-secret': VALID_SECRET },
        payload: { variant_ids: [VARIANT_UUID, 'not-a-uuid'] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_request_body');
      expect(orchestrator.execute).not.toHaveBeenCalled();
    });

    it('returns 400 when phases contains an unknown name (no silent drop)', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-seller-listings',
        headers: { 'x-internal-secret': VALID_SECRET },
        payload: { phases: ['pricing', 'unknown-phase'] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_request_body');
      expect(orchestrator.execute).not.toHaveBeenCalled();
    });

    it('returns 400 when batch_limit is not a positive integer', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-seller-listings',
        headers: { 'x-internal-secret': VALID_SECRET },
        payload: { batch_limit: 0 },
      });

      expect(res.statusCode).toBe(400);
      expect(orchestrator.execute).not.toHaveBeenCalled();
    });

    it('returns 400 when phases is provided as an empty array', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-seller-listings',
        headers: { 'x-internal-secret': VALID_SECRET },
        payload: { phases: [] },
      });

      expect(res.statusCode).toBe(400);
      expect(orchestrator.execute).not.toHaveBeenCalled();
    });

    it('returns 400 when variant_ids is provided as an empty array', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-seller-listings',
        headers: { 'x-internal-secret': VALID_SECRET },
        payload: { variant_ids: [] },
      });

      expect(res.statusCode).toBe(400);
      expect(orchestrator.execute).not.toHaveBeenCalled();
    });
  });

  describe('orchestrator failure', () => {
    it('returns 500 with reconcile_failed when the orchestrator throws', async () => {
      orchestrator.execute.mockRejectedValueOnce(new Error('boom'));

      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-seller-listings',
        headers: { 'x-internal-secret': VALID_SECRET },
        payload: {},
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('reconcile_failed');
    });
  });

  describe('legacy alias removed', () => {
    it('returns 404 for the deprecated /reconcile-procurement-declared-stock path', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/internal/cron/reconcile-procurement-declared-stock',
        headers: { 'x-internal-secret': VALID_SECRET },
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
