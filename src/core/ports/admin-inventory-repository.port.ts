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
}
