import { injectable, inject } from 'tsyringe';
import { TOKENS, UC_TOKENS } from '../../../di/tokens.js';
import type { IMarketplaceAdapterRegistry } from '../../ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type {
  JitPublishAudit,
  PublishSellerListingToMarketplaceResult,
} from './seller-listing.types.js';
import {
  ComputeJitPublishPlanUseCase,
  type JitPublishPlan,
  type JitPublishWalletStatus,
} from './compute-jit-publish-plan.use-case.js';

export interface PublishSellerListingToMarketplaceDtoInput {
  readonly listing_id: string;
  readonly admin_id: string;
}

@injectable()
export class PublishSellerListingToMarketplaceUseCase {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.AdminSellerRepository) private sellerRepo: IAdminSellerRepository,
    @inject(UC_TOKENS.ComputeJitPublishPlan) private jitPlanner: ComputeJitPublishPlanUseCase,
  ) {}

  async execute(dto: PublishSellerListingToMarketplaceDtoInput): Promise<PublishSellerListingToMarketplaceResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');

    await this.sellerRepo.repairSellerListingRowIfStaleFailure(dto.listing_id);

    const ctx = await this.sellerRepo.getSellerListingPublishContext(dto.listing_id);
    if (!ctx) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const extProduct = ctx.external_product_id?.trim();
    if (!extProduct) {
      throw new Error('Listing has no external_product_id — link a marketplace catalog product first');
    }

    const existingAuction = ctx.external_listing_id?.trim();
    if (existingAuction) {
      return {
        listing_id: ctx.listing_id,
        external_listing_id: existingAuction,
        status: ctx.status,
        skipped_already_published: true,
      };
    }

    if (ctx.price_cents <= 0) {
      const msg = 'Listing price must be greater than zero before marketplace publish';
      await this.sellerRepo.markSellerListingPublishFailure(dto.listing_id, msg);
      throw new Error(msg);
    }

    /**
     * Eneba `S_createAuction` does not accept plain auctions with `keys: []` — you must send either
     * plaintext keys or `declaredStock`. CRM publish never uploads keys here, so we always derive
     * declared stock from available inventory keys for Eneba (`declared_stock` and `key_upload` rows).
     *
     * When stock is zero we attempt a JIT-publish fallback: if a linked
     * buyer offer has wallet credits we size the auction off that offer
     * and price it via `SellerPricingService.suggestPrice`.
     */
    let quantity: number | undefined;
    let wirePriceCents: number = ctx.price_cents;
    let jitAudit: JitPublishAudit | undefined;
    const enebaDeclaredStockFromInventory =
      ctx.provider_code === 'eneba' &&
      (ctx.listing_type === 'declared_stock' || ctx.listing_type === 'key_upload');

    if (enebaDeclaredStockFromInventory) {
      const qty = await this.sellerRepo.countAvailableProductKeysForVariant(ctx.variant_id);
      quantity = qty;
      if (qty <= 0) {
        const plan = await this.jitPlanner.execute({
          variantId: ctx.variant_id,
          listingId: ctx.listing_id,
          externalProductId: extProduct,
          providerAccountId: ctx.provider_account_id,
          listingType: ctx.listing_type,
          listingCurrency: ctx.currency,
          listingMinCents: 0,
        });

        if (plan.kind !== 'plan') {
          const msg = formatJitFailureMessage(plan);
          await this.sellerRepo.markSellerListingPublishFailure(dto.listing_id, msg);
          throw new Error(msg);
        }

        quantity = plan.declaredStock;
        wirePriceCents = plan.suggestion.suggestedPriceCents;

        await this.sellerRepo.updateSellerListingJitPublishPrice({
          listing_id: ctx.listing_id,
          price_cents: plan.suggestion.suggestedPriceCents,
          source_provider_code: plan.chosenBuyer.providerCode,
          source_provider_account_id: plan.chosenBuyer.providerAccountId,
        });

        jitAudit = {
          used: true,
          source_buyer: {
            provider_code: plan.chosenBuyer.providerCode,
            provider_account_id: plan.chosenBuyer.providerAccountId,
          },
          declared_stock: plan.declaredStock,
          cost_basis_cents: plan.costInListingCurrencyCents,
          cost_basis_currency: ctx.currency,
          priced_at_cents: plan.suggestion.suggestedPriceCents,
          priced_at_currency: plan.suggestion.currency,
        };
      }
    }

    const bridgeEnebaKeyUploadToDeclaredStock =
      ctx.provider_code === 'eneba' && ctx.listing_type === 'key_upload';
    const wireListingType = bridgeEnebaKeyUploadToDeclaredStock ? 'declared_stock' : ctx.listing_type;

    const adapter = this.registry.getListingAdapter(ctx.provider_code);
    if (!adapter) {
      const msg = `Provider "${ctx.provider_code}" does not support automated marketplace listing publish`;
      await this.sellerRepo.markSellerListingPublishFailure(dto.listing_id, msg);
      throw new Error(msg);
    }

    try {
      const discoveredAuctionId =
        (await adapter.discoverExistingAuctionId?.(extProduct).catch(() => null)) ?? null;

      const declaredStockForPersist =
        wireListingType === 'declared_stock' ? (quantity as number) : 0;

      let externalListingId: string;

      if (discoveredAuctionId) {
        const upd = await adapter.updateListing({
          externalListingId: discoveredAuctionId,
          priceCents: wirePriceCents,
          currency: ctx.currency,
          ...(wireListingType === 'declared_stock' ? { quantity: quantity as number } : {}),
        });
        if (!upd.success) {
          const msg =
            upd.error ??
            'Marketplace already has an auction for this product; update failed (try again after rate limit or bind auction manually)';
          throw new Error(msg);
        }
        externalListingId = discoveredAuctionId;
      } else {
        const remote = await adapter.createListing({
          externalProductId: extProduct,
          priceCents: wirePriceCents,
          currency: ctx.currency,
          listingType: wireListingType,
          ...(wireListingType === 'declared_stock' ? { quantity: quantity as number } : {}),
        });
        externalListingId = remote.externalListingId;
      }

      const result = await this.sellerRepo.finalizeSellerListingMarketplacePublishSuccess({
        listing_id: dto.listing_id,
        external_listing_id: externalListingId,
        declared_stock: declaredStockForPersist,
        admin_id: dto.admin_id,
        ...(bridgeEnebaKeyUploadToDeclaredStock ? { listing_type: 'declared_stock' as const } : {}),
      });

      return jitAudit ? { ...result, jit_publish: jitAudit } : result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Marketplace publish failed';
      await this.sellerRepo.markSellerListingPublishFailure(dto.listing_id, msg);
      throw err instanceof Error ? err : new Error(msg);
    }
  }
}

function formatJitFailureMessage(plan: Exclude<JitPublishPlan, { kind: 'plan' }>): string {
  if (plan.kind === 'no-buyers') {
    return (
      'Eneba marketplace publish requires at least one available key for this variant ' +
      '(declared stock is taken from inventory; creating an auction without keys or stock is not supported)'
    );
  }
  // 'no-funded' — buyers exist but none have wallet credits
  const summary = plan.walletDiagnostics
    .map((w) => formatWalletDiagnostic(w))
    .join('; ');
  return (
    'Eneba marketplace publish blocked: no inventory keys and no buyer wallet has credits for this variant. ' +
    `Linked buyers: ${summary || 'none'}.`
  );
}

function formatWalletDiagnostic(w: JitPublishWalletStatus): string {
  const balance =
    w.walletAvailableCents == null ? 'wallet?' : `bal=${w.walletAvailableCents}c ${w.offerCurrency}`;
  return `${w.providerCode} (${balance}, cost=${w.unitCostCents}c ${w.offerCurrency}, ${w.reason ?? 'no_credits'})`;
}
