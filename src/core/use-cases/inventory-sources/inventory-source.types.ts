export interface LinkVariantInventorySourceDto { variant_id: string; source_id: string; admin_id: string }
export interface LinkVariantInventorySourceResult { success: boolean }
export interface UnlinkVariantInventorySourceDto { variant_id: string; source_id: string; admin_id: string }
export interface UnlinkVariantInventorySourceResult { success: boolean }
export interface ListVariantInventorySourcesDto { variant_id: string }
export interface ListVariantInventorySourcesResult { sources: unknown[] }
export interface ListLinkableInventorySourcesDto { variant_id: string }
export interface ListLinkableInventorySourcesResult { sources: unknown[] }
