import type {
  LinkVariantInventorySourceDto,
  LinkVariantInventorySourceResult,
  UnlinkVariantInventorySourceDto,
  UnlinkVariantInventorySourceResult,
  ListVariantInventorySourcesDto,
  ListVariantInventorySourcesResult,
  ListLinkableInventorySourcesDto,
  ListLinkableInventorySourcesResult,
} from '../use-cases/inventory-sources/inventory-source.types.js';

export interface IAdminInventorySourceRepository {
  linkVariantInventorySource(dto: LinkVariantInventorySourceDto): Promise<LinkVariantInventorySourceResult>;
  unlinkVariantInventorySource(dto: UnlinkVariantInventorySourceDto): Promise<UnlinkVariantInventorySourceResult>;
  listVariantInventorySources(dto: ListVariantInventorySourcesDto): Promise<ListVariantInventorySourcesResult>;
  listLinkableInventorySources(dto: ListLinkableInventorySourcesDto): Promise<ListLinkableInventorySourcesResult>;
}
