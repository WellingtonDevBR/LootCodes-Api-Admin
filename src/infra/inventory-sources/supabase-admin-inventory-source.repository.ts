import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminInventorySourceRepository } from '../../core/ports/admin-inventory-source-repository.port.js';
import type {
  LinkVariantInventorySourceDto,
  LinkVariantInventorySourceResult,
  UnlinkVariantInventorySourceDto,
  UnlinkVariantInventorySourceResult,
  ListVariantInventorySourcesDto,
  ListVariantInventorySourcesResult,
  ListLinkableInventorySourcesDto,
  ListLinkableInventorySourcesResult,
} from '../../core/use-cases/inventory-sources/inventory-source.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminInventorySourceRepository');

@injectable()
export class SupabaseAdminInventorySourceRepository implements IAdminInventorySourceRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async linkVariantInventorySource(dto: LinkVariantInventorySourceDto): Promise<LinkVariantInventorySourceResult> {
    logger.info('Linking variant to inventory source', { variantId: dto.variant_id, sourceId: dto.source_id });

    await this.db.rpc('admin_link_variant_inventory_source', {
      p_variant_id: dto.variant_id,
      p_source_id: dto.source_id,
      p_admin_id: dto.admin_id,
    });

    return { success: true };
  }

  async unlinkVariantInventorySource(dto: UnlinkVariantInventorySourceDto): Promise<UnlinkVariantInventorySourceResult> {
    logger.info('Unlinking variant from inventory source', { variantId: dto.variant_id, sourceId: dto.source_id });

    await this.db.rpc('admin_unlink_variant_inventory_source', {
      p_variant_id: dto.variant_id,
      p_source_id: dto.source_id,
      p_admin_id: dto.admin_id,
    });

    return { success: true };
  }

  async listVariantInventorySources(dto: ListVariantInventorySourcesDto): Promise<ListVariantInventorySourcesResult> {
    const rows = await this.db.rpc<unknown[]>(
      'admin_list_variant_inventory_sources',
      { p_consumer_variant_id: dto.variant_id },
    );

    return { sources: Array.isArray(rows) ? rows : [] };
  }

  async listLinkableInventorySources(dto: ListLinkableInventorySourcesDto): Promise<ListLinkableInventorySourcesResult> {
    const rows = await this.db.rpc<unknown[]>(
      'admin_list_linkable_inventory_sources',
      { p_consumer_variant_id: dto.variant_id },
    );

    return { sources: Array.isArray(rows) ? rows : [] };
  }
}
