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
      p_consumer_variant_id: dto.variant_id,
      p_source_variant_id: dto.source_id,
      p_actor: dto.admin_id,
    });

    return { success: true };
  }

  async unlinkVariantInventorySource(dto: UnlinkVariantInventorySourceDto): Promise<UnlinkVariantInventorySourceResult> {
    logger.info('Unlinking variant inventory source', { linkId: dto.link_id });

    await this.db.rpc('admin_unlink_variant_inventory_source', {
      p_link_id: dto.link_id,
      p_actor: dto.admin_id,
    });

    return { success: true };
  }

  async listVariantInventorySources(dto: ListVariantInventorySourcesDto): Promise<ListVariantInventorySourcesResult> {
    const rows = await this.db.rpc<unknown[]>(
      'admin_list_variant_inventory_sources',
      { p_consumer_variant_id: dto.variant_id },
    );

    // Remap DB column names to the shape CRM's InventorySourceItem expects:
    //   link_id        → id
    //   platform_names → source_platform_names
    //   region_name    → source_region_name
    //   available_keys → source_available_keys
    type RawRow = {
      link_id: string;
      source_variant_id: string;
      source_product_name: string | null;
      platform_names: string[];
      region_name: string | null;
      available_keys: number;
    };
    const raw = (Array.isArray(rows) ? rows : []) as RawRow[];
    const sources = raw.map((r) => ({
      id: r.link_id,
      variant_id: dto.variant_id,
      source_variant_id: r.source_variant_id,
      source_product_name: r.source_product_name,
      source_platform_names: r.platform_names ?? [],
      source_region_name: r.region_name,
      source_available_keys: r.available_keys ?? 0,
    }));

    return { sources };
  }

  async listLinkableInventorySources(dto: ListLinkableInventorySourcesDto): Promise<ListLinkableInventorySourcesResult> {
    const rows = await this.db.rpc<unknown[]>(
      'admin_list_linkable_inventory_sources',
      { p_consumer_variant_id: dto.variant_id },
    );

    // Remap DB column names to the shape CRM's LinkableSourceItem expects:
    //   variant_label → sku
    type RawRow = {
      variant_id: string;
      variant_label: string;
      product_name: string;
      platform_names: string[];
      region_name: string | null;
      available_keys: number;
    };
    const raw = (Array.isArray(rows) ? rows : []) as RawRow[];
    const sources = raw.map((r) => ({
      variant_id: r.variant_id,
      product_name: r.product_name,
      platform_names: r.platform_names ?? [],
      region_name: r.region_name,
      available_keys: r.available_keys ?? 0,
      sku: r.variant_label,
    }));

    return { sources };
  }
}
