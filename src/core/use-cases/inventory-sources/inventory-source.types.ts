export interface LinkVariantInventorySourceDto { variant_id: string; source_id: string; admin_id: string }
export interface LinkVariantInventorySourceResult { success: boolean }
/**
 * DB unlink takes a link_id (the variant_inventory_sources PK), not a
 * consumer+source variant pair.  The CRM passes source.id which is the
 * link row id returned by admin_list_variant_inventory_sources.
 */
export interface UnlinkVariantInventorySourceDto { link_id: string; admin_id: string }
export interface UnlinkVariantInventorySourceResult { success: boolean }
export interface ListVariantInventorySourcesDto { variant_id: string }
export interface ListVariantInventorySourcesResult { sources: unknown[] }
export interface ListLinkableInventorySourcesDto { variant_id: string }
export interface ListLinkableInventorySourcesResult { sources: unknown[] }
