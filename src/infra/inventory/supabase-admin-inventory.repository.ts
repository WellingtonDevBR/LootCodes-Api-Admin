import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminInventoryRepository } from '../../core/ports/admin-inventory-repository.port.js';
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
} from '../../core/use-cases/inventory/inventory.types.js';

@injectable()
export class SupabaseAdminInventoryRepository implements IAdminInventoryRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async emitInventoryStockChanged(dto: EmitInventoryStockChangedDto): Promise<EmitInventoryStockChangedResult> {
    await this.db.rpc('emit_inventory_stock_changed', {
      p_product_ids: dto.product_ids,
      p_reason: dto.reason,
      p_admin_id: dto.admin_id,
    });
    return { success: true };
  }

  async sendStockNotificationsNow(dto: SendStockNotificationsNowDto): Promise<SendStockNotificationsNowResult> {
    const result = await this.db.rpc<{ notifications_sent: number }>(
      'send_stock_notifications_now',
      { p_admin_id: dto.admin_id },
    );
    return { success: true, notifications_sent: result.notifications_sent };
  }

  async replaceKey(dto: ReplaceKeyDto): Promise<ReplaceKeyResult> {
    const result = await this.db.rpc<{ new_key_id: string }>('atomic_replace_key', {
      p_order_item_id: dto.order_item_id,
      p_old_key_id: dto.old_key_id,
      p_admin_id: dto.admin_id,
    });
    return { success: true, new_key_id: result.new_key_id };
  }

  async fixKeyStates(dto: FixKeyStatesDto): Promise<FixKeyStatesResult> {
    const result = await this.db.rpc<{ keys_fixed: number }>('admin_fix_key_states', {
      p_variant_id: dto.variant_id,
      p_admin_id: dto.admin_id,
    });
    return { success: true, keys_fixed: result.keys_fixed };
  }

  async updateAffectedKey(dto: UpdateAffectedKeyDto): Promise<UpdateAffectedKeyResult> {
    await this.db.update('product_keys', { id: dto.key_id }, {
      status: dto.new_status,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  }

  async decryptKeys(dto: DecryptKeysDto): Promise<DecryptKeysResult> {
    const keys = await this.db.rpc<Array<{ id: string; decrypted_value: string }>>(
      'admin_decrypt_keys',
      { p_key_ids: dto.key_ids, p_admin_id: dto.admin_id },
    );
    return { keys: Array.isArray(keys) ? keys : [] };
  }

  async recryptProductKeys(dto: RecryptProductKeysDto): Promise<RecryptProductKeysResult> {
    const result = await this.db.rpc<{ keys_recrypted: number }>('admin_recrypt_product_keys', {
      p_product_id: dto.product_id,
      p_admin_id: dto.admin_id,
    });
    return { success: true, keys_recrypted: result.keys_recrypted };
  }

  async setKeysSalesBlocked(dto: SetKeysSalesBlockedDto): Promise<SetKeysSalesBlockedResult> {
    const updated = await this.db.update('product_keys',
      { id: dto.key_ids[0] },
      { sales_blocked: dto.blocked, updated_at: new Date().toISOString() },
    );

    let keysUpdated = updated.length;
    for (let i = 1; i < dto.key_ids.length; i++) {
      const result = await this.db.update('product_keys',
        { id: dto.key_ids[i] },
        { sales_blocked: dto.blocked, updated_at: new Date().toISOString() },
      );
      keysUpdated += result.length;
    }

    return { success: true, keys_updated: keysUpdated };
  }

  async setVariantSalesBlocked(dto: SetVariantSalesBlockedDto): Promise<SetVariantSalesBlockedResult> {
    await this.db.update('product_variants', { id: dto.variant_id }, {
      sales_blocked: dto.blocked,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  }

  async markKeysFaulty(dto: MarkKeysFaultyDto): Promise<MarkKeysFaultyResult> {
    let keysMarked = 0;
    for (const keyId of dto.key_ids) {
      const result = await this.db.update('product_keys', { id: keyId }, {
        status: 'faulty',
        faulty_reason: dto.reason,
        updated_at: new Date().toISOString(),
      });
      keysMarked += result.length;
    }
    return { success: true, keys_marked: keysMarked };
  }

  async linkReplacementKey(dto: LinkReplacementKeyDto): Promise<LinkReplacementKeyResult> {
    await this.db.update('product_keys', { id: dto.replacement_key_id }, {
      replaces_key_id: dto.original_key_id,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  }

  async manualSell(dto: ManualSellDto): Promise<ManualSellResult> {
    const result = await this.db.rpc<{ order_id: string }>('admin_manual_sell', {
      p_variant_id: dto.variant_id,
      p_quantity: dto.quantity,
      p_buyer_email: dto.buyer_email,
      p_admin_id: dto.admin_id,
    });
    return { success: true, order_id: result.order_id };
  }

  async updateVariantPrice(dto: UpdateVariantPriceDto): Promise<UpdateVariantPriceResult> {
    await this.db.update('product_variants', { id: dto.variant_id }, {
      price_cents: dto.price_cents,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  }
}
