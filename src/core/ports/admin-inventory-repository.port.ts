import type {
  EmitInventoryStockChangedDto,
  EmitInventoryStockChangedResult,
  SendStockNotificationsNowDto,
  SendStockNotificationsNowResult,
  ReplaceKeyDto,
  ReplaceKeyResult,
  FixKeyStatesDto,
  FixKeyStatesResult,
  UpdateAffectedKeyDto,
  UpdateAffectedKeyResult,
  DecryptKeysDto,
  DecryptKeysResult,
  RecryptProductKeysDto,
  RecryptProductKeysResult,
  SetKeysSalesBlockedDto,
  SetKeysSalesBlockedResult,
  SetVariantSalesBlockedDto,
  SetVariantSalesBlockedResult,
  MarkKeysFaultyDto,
  MarkKeysFaultyResult,
  LinkReplacementKeyDto,
  LinkReplacementKeyResult,
  ManualSellDto,
  ManualSellResult,
  UpdateVariantPriceDto,
  UpdateVariantPriceResult,
  GetInventoryCatalogDto,
  GetInventoryCatalogResult,
  GetVariantContextDto,
  GetVariantContextResult,
  UploadKeysDto,
  UploadKeysResult,
  GetInventoryKpisResult,
  ListKeysDto,
  ListKeysResult,
  ListVariantKeysDto,
  ListVariantKeysResult,
  LookupKeysByValueDto,
  LookupKeysByValueResult,
  BulkBurnKeysDto,
  BulkBurnKeysResult,
  ManualSellKeysDto,
  ManualSellKeysResult,
  ExportKeysDto,
  ExportKeysResult,
  DecryptKeysOrchestrateDto,
  DecryptKeysOrchestrateResult,
} from '../use-cases/inventory/inventory.types.js';

export interface IAdminInventoryRepository {
  emitInventoryStockChanged(dto: EmitInventoryStockChangedDto): Promise<EmitInventoryStockChangedResult>;
  sendStockNotificationsNow(dto: SendStockNotificationsNowDto): Promise<SendStockNotificationsNowResult>;
  replaceKey(dto: ReplaceKeyDto): Promise<ReplaceKeyResult>;
  fixKeyStates(dto: FixKeyStatesDto): Promise<FixKeyStatesResult>;
  updateAffectedKey(dto: UpdateAffectedKeyDto): Promise<UpdateAffectedKeyResult>;
  decryptKeys(dto: DecryptKeysDto): Promise<DecryptKeysResult>;
  recryptProductKeys(dto: RecryptProductKeysDto): Promise<RecryptProductKeysResult>;
  setKeysSalesBlocked(dto: SetKeysSalesBlockedDto): Promise<SetKeysSalesBlockedResult>;
  setVariantSalesBlocked(dto: SetVariantSalesBlockedDto): Promise<SetVariantSalesBlockedResult>;
  markKeysFaulty(dto: MarkKeysFaultyDto): Promise<MarkKeysFaultyResult>;
  linkReplacementKey(dto: LinkReplacementKeyDto): Promise<LinkReplacementKeyResult>;
  manualSell(dto: ManualSellDto): Promise<ManualSellResult>;
  updateVariantPrice(dto: UpdateVariantPriceDto): Promise<UpdateVariantPriceResult>;
  getInventoryCatalog(dto: GetInventoryCatalogDto): Promise<GetInventoryCatalogResult>;
  getVariantContext(dto: GetVariantContextDto): Promise<GetVariantContextResult>;
  uploadKeys(dto: UploadKeysDto, encryptFn: (plaintext: string) => Promise<{
    encrypted_key: string;
    encryption_iv: string;
    encryption_salt: string;
    encryption_key_id: string;
  }>): Promise<UploadKeysResult>;
  /** KPI rollup for the admin dashboard: available-key count + USD cost rollup. */
  getInventoryKpis(): Promise<GetInventoryKpisResult>;
  /** Paginated, enriched product-key list with product/variant/order joins. */
  listKeys(dto: ListKeysDto): Promise<ListKeysResult>;
  /** Variant-scoped paginated key list plus full available/reserved/sold counts. */
  listVariantKeys(dto: ListVariantKeysDto): Promise<ListVariantKeysResult>;
  /** Hashed plaintext lookup — never receives raw values across the wire. */
  lookupKeysByValue(dto: LookupKeysByValueDto): Promise<LookupKeysByValueResult>;
  /**
   * Bulk-burn keys that are currently `available`. Keys in any other state
   * are returned with a `state_locked:<state>` outcome.
   */
  bulkBurnAvailableKeys(dto: BulkBurnKeysDto): Promise<BulkBurnKeysResult>;
  /** Create a manual order + flip keys to `used` in a single repo call. */
  manualSellKeys(dto: ManualSellKeysDto): Promise<ManualSellKeysResult>;
  /**
   * Audit-logging wrapper around the encryption port. Loads encrypted rows,
   * delegates decryption to the provided callback, then writes the
   * `admin_actions` audit row in one place.
   */
  decryptAndAuditKeys(
    dto: DecryptKeysOrchestrateDto,
    decryptFn: (row: {
      id: string;
      encrypted_key: string | null;
      encryption_iv: string | null;
      encryption_salt: string | null;
      encryption_key_id: string | null;
    }) => Promise<string>,
  ): Promise<DecryptKeysOrchestrateResult>;
  /**
   * CSV export of keys — loads + decrypts via callback, writes audit row,
   * optionally marks the exported keys as `burnt`.
   */
  exportKeysCsv(
    dto: ExportKeysDto,
    decryptFn: (row: {
      id: string;
      encrypted_key: string | null;
      encryption_iv: string | null;
      encryption_salt: string | null;
      encryption_key_id: string | null;
    }) => Promise<string>,
  ): Promise<ExportKeysResult>;
}
