import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../src/core/ports/marketplace-adapter.port.js';
import { SupabaseAdminProcurementRepository } from '../src/infra/procurement/supabase-admin-procurement.repository.js';
import { syncAppRouteProductCatalog } from '../src/infra/procurement/approute-catalog-sync.js';

vi.mock('../src/infra/procurement/approute-catalog-sync.js', () => ({
  syncAppRouteProductCatalog: vi.fn(),
}));

const ADMIN_ID = 'aaaaaaaa-bbbb-4ccc-bddd-eeeeeeeeeeee';

describe('SupabaseAdminProcurementRepository.ingestProviderCatalog (approute)', () => {
  const mockedSync = vi.mocked(syncAppRouteProductCatalog);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs syncAppRouteProductCatalog instead of start_catalog_ingestion_job RPC', async () => {
    mockedSync.mockResolvedValue({ success: true, upserted: 12 });

    const rpc = vi.fn();
    const query = vi.fn().mockResolvedValue([{ id: 'acct-approute-1' }]);
    const db = { rpc, query } as unknown as IDatabase;
    const registry = {} as IMarketplaceAdapterRegistry;

    const repo = new SupabaseAdminProcurementRepository(db, registry);
    const result = await repo.ingestProviderCatalog({
      provider_code: 'approute',
      admin_id: ADMIN_ID,
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      'provider_accounts',
      expect.objectContaining({
        eq: [['provider_code', 'approute']],
      }),
    );
    expect(mockedSync).toHaveBeenCalledWith(db, 'acct-approute-1');
    expect(result.status).toBe('completed');
    expect(result.job_id.startsWith('inline-sync-approute-')).toBe(true);
  });

  it('still uses RPC for non-approute providers', async () => {
    mockedSync.mockResolvedValue({ success: true, upserted: 1 });

    const rpc = vi.fn().mockResolvedValue({ job_id: 'job-bamboo', status: 'queued' });
    const query = vi.fn();
    const db = { rpc, query } as unknown as IDatabase;

    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);
    const result = await repo.ingestProviderCatalog({
      provider_code: 'bamboo',
      admin_id: ADMIN_ID,
    });

    expect(mockedSync).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('start_catalog_ingestion_job', {
      p_provider_code: 'bamboo',
      p_admin_id: ADMIN_ID,
    });
    expect(result).toEqual({ job_id: 'job-bamboo', status: 'queued' });
  });

  it('marks inline-sync-approute job ids completed without querying RPC/job tables', async () => {
    const queryOne = vi.fn();
    const db = { queryOne } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);

    const result = await repo.ingestProviderCatalogStatus({
      job_id: 'inline-sync-approute-aaaaaaaa-bbbb-cccc-dddddddddddd',
    });

    expect(queryOne).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    expect(result.progress).toBe(100);
  });
});
