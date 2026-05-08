/**
 * Digiseller/Plati.market marketplace adapter for LootCodes Admin API.
 *
 * Capabilities:
 *   - ISellerListingAdapter      (create/update/deactivate/status)
 *   - ISellerKeyUploadAdapter    (POST /api/product/content/add/text)
 *   - ISellerStockSyncAdapter    (status toggle based on remote stock count)
 *   - ISellerDeclaredStockAdapter(Form delivery — declared stock via sales_limit)
 *   - ISellerPricingAdapter      (net payout from commission %)
 *   - IProductSearchAdapter      (POST seller-goods — name filter client-side)
 *
 * Two delivery models:
 *   key_upload:      Keys uploaded via /api/product/content/add/text
 *   declared_stock:  Form delivery — Digiseller POSTs to our webhook on sale
 *
 * Auth: SHA256 signature-based token, appended as ?token=X query param.
 * Prices: Floats (e.g. 7.25) — converted to/from cents here.
 * Product IDs: Integers — stored as strings in seller_listings.
 */
import type { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import type {
  ISellerListingAdapter,
  ISellerKeyUploadAdapter,
  ISellerStockSyncAdapter,
  ISellerDeclaredStockAdapter,
  ISellerPricingAdapter,
  IProductSearchAdapter,
  ProductSearchResult,
  CreateListingParams,
  CreateListingResult,
  UpdateListingParams,
  UpdateListingResult,
  ListingStatusResult,
  UploadKeysResult,
  SyncStockLevelResult,
  DeclareStockResult,
  KeyProvisionParams,
  KeyProvisionResult,
  PricingContext,
  SellerPayoutResult,
} from '../../../core/ports/marketplace-adapter.port.js';
import type {
  DigisellerCreateProductResponse,
  DigisellerEditProductResponse,
  DigisellerProductStatusResponse,
  DigisellerProductDataResponse,
  DigisellerAddTextContentResponse,
  DigisellerCodeCountResponse,
  DigisellerCloneProductResponse,
  DigisellerApiResponse,
  DigisellerProductType,
  DigisellerListingOpts,
  DigisellerSellerGoodsResponse,
  DigisellerSellerGoodsRow,
} from './types.js';
import { DIGISELLER_CREATE_PATHS, DIGISELLER_LOCALES, DEFAULT_LISTING_OPTS } from './types.js';
import { createLogger } from '../../../shared/logger.js';
import { floatToCents } from '../../../shared/pricing.js';

const logger = createLogger('digiseller-adapter');

function centsToDigiPrice(cents: number): number {
  return Math.round(cents) / 100;
}

const DEFAULT_COMMISSION_RATE_PERCENT = 5;

export class DigisellerMarketplaceAdapter
  implements
    ISellerListingAdapter,
    ISellerKeyUploadAdapter,
    ISellerStockSyncAdapter,
    ISellerDeclaredStockAdapter,
    ISellerPricingAdapter,
    IProductSearchAdapter
{
  private readonly listingOpts: DigisellerListingOpts;
  private readonly commissionRatePercent: number;
  private readonly sellerNumericId?: number;

  constructor(
    private readonly httpClient: MarketplaceHttpClient,
    options?: {
      defaultCurrency?: string;
      listingOpts?: Partial<DigisellerListingOpts>;
      commissionRatePercent?: number;
      sellerNumericId?: number;
    },
  ) {
    this.listingOpts = {
      ...DEFAULT_LISTING_OPTS,
      ...options?.listingOpts,
      defaultCurrency: options?.defaultCurrency ?? options?.listingOpts?.defaultCurrency ?? 'USD',
    };
    this.commissionRatePercent = Math.max(0, Math.min(100,
      options?.commissionRatePercent ?? DEFAULT_COMMISSION_RATE_PERCENT));
    this.sellerNumericId = options?.sellerNumericId;
  }

  // ─── ISellerListingAdapter ───────────────────────────────────────────

  async createListing(params: CreateListingParams): Promise<CreateListingResult> {
    const productType = this.resolveProductType(params);

    if (productType === 'clone') {
      return this.cloneProduct(params);
    }

    const body = this.buildCreateBody(params, productType);
    const createPath = DIGISELLER_CREATE_PATHS[productType] ?? DIGISELLER_CREATE_PATHS.arbitrary;

    logger.info('Digiseller createListing', { createPath, productType, price: body.price });

    const resp = await this.httpClient.post<DigisellerCreateProductResponse>(createPath, body);
    this.assertRetval(resp, 'createListing');
    const productId = resp.content.product_id;

    logger.info('Digiseller product created', {
      productId, price: centsToDigiPrice(params.priceCents), currency: params.currency,
    });

    if (this.listingOpts.platiCategoryId) {
      await this.addToPlatiCategory(productId, this.listingOpts.platiCategoryId);
    }

    const isFormDelivery = productType === 'arbitrary' || this.listingOpts.contentType === 'Form';
    if (isFormDelivery && this.listingOpts.callbackUrl) {
      await this.setupFormDelivery(productId);
    }

    return { externalListingId: String(productId), status: 'active' };
  }

  async updateListing(params: UpdateListingParams): Promise<UpdateListingResult> {
    const productId = Number(params.externalListingId);
    const body: Record<string, unknown> = {};

    if (params.priceCents != null) {
      body.price = {
        price: centsToDigiPrice(params.priceCents),
        currency: this.listingOpts.defaultCurrency,
      };
    }

    const resp = await this.httpClient.post<DigisellerEditProductResponse>(
      this.resolveEditPath(productId), body,
    );
    this.assertRetval(resp, 'updateListing');

    logger.info('Digiseller product updated', { productId, priceCents: params.priceCents });
    return { success: true };
  }

  async deactivateListing(externalListingId: string): Promise<{ success: boolean }> {
    const productId = Number(externalListingId);
    const resp = await this.httpClient.post<DigisellerProductStatusResponse>(
      '/api/product/edit/V2/status',
      { new_status: 'disabled', products: [productId] },
    );
    this.assertRetval(resp, 'deactivateListing');
    logger.info('Digiseller product deactivated', { productId });
    return { success: true };
  }

  async getListingStatus(externalListingId: string): Promise<ListingStatusResult> {
    const productId = Number(externalListingId);
    const resp = await this.httpClient.get<DigisellerProductDataResponse>(
      `/api/products/${productId}/data`,
    );

    if (resp.retval !== 0 || !resp.product) {
      throw new Error(`Digiseller getListingStatus failed: retval=${resp.retval} ${resp.retdesc ?? ''}`);
    }

    const p = resp.product;
    const priceCents = p.prices?.initial
      ? floatToCents(p.prices.initial.price)
      : floatToCents(p.price);

    return {
      status: p.is_available === 0 ? 'paused' : 'active',
      externalListingId: String(p.id),
      stock: p.num_in_stock ?? 0,
      priceCents,
    };
  }

  // ─── ISellerKeyUploadAdapter ─────────────────────────────────────────

  async uploadKeys(externalListingId: string, keys: string[]): Promise<UploadKeysResult> {
    const productId = Number(externalListingId);

    const body = {
      product_id: productId,
      content: keys.map((value, idx) => ({ serial: String(idx + 1), value })),
    };

    const resp = await this.httpClient.post<DigisellerAddTextContentResponse>(
      '/api/product/content/add/text', body,
    );

    if (resp.retval !== 0) {
      const errorMsg = resp.retdesc ?? 'Unknown error';
      logger.error('Digiseller key upload failed', new Error(errorMsg), { productId, keyCount: keys.length });
      return { uploaded: 0, failed: keys.length, errors: [errorMsg] };
    }

    const accepted = resp.content?.added ?? keys.length;
    logger.info('Digiseller keys uploaded', { productId, accepted, total: keys.length });
    return { uploaded: accepted, failed: keys.length - accepted };
  }

  // ─── ISellerStockSyncAdapter ─────────────────────────────────────────

  async syncStockLevel(externalListingId: string, _availableQuantity: number): Promise<SyncStockLevelResult> {
    const productId = Number(externalListingId);
    const remoteStock = await this.getStockCount(productId);
    const desiredStatus = remoteStock === 0 ? 'disabled' : 'enabled';

    try {
      await this.setProductStatus(productId, desiredStatus);
    } catch (err) {
      logger.warn('Digiseller setProductStatus failed during sync', {
        productId, desiredStatus, remoteStock,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('Digiseller stock synced', { productId, remoteStock });
    return { success: true, syncedQuantity: remoteStock };
  }

  // ─── ISellerDeclaredStockAdapter (Form delivery) ────────────────────

  async declareStock(externalListingId: string, quantity: number): Promise<DeclareStockResult> {
    const productId = Number(externalListingId);

    if (this.listingOpts.callbackUrl) {
      await this.ensureFormDeliveryConfigured(productId);
    }

    await this.updateSalesLimit(productId, quantity);

    const desiredStatus = quantity === 0 ? 'disabled' : 'enabled';
    try {
      await this.setProductStatus(productId, desiredStatus);
    } catch (err) {
      logger.warn('Digiseller setProductStatus failed during declareStock', {
        productId, desiredStatus, quantity,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('Digiseller declared stock updated', { productId, declaredQuantity: quantity });
    return { success: true, declaredQuantity: quantity };
  }

  async provisionKeys(_params: KeyProvisionParams): Promise<KeyProvisionResult> {
    return { success: true, provisioned: 0 };
  }

  async cancelReservation(_reservationId: string, _reason: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  // ─── ISellerPricingAdapter ──────────────────────────────────────────

  async calculateNetPayout(ctx: PricingContext): Promise<SellerPayoutResult> {
    const grossCents = ctx.priceCents;
    const feeCents = Math.round(grossCents * this.commissionRatePercent / 100);
    const netPayoutCents = grossCents - feeCents;
    return { grossPriceCents: grossCents, feeCents, netPayoutCents };
  }

  // ─── IProductSearchAdapter (seller-goods; name filter client-side) ─

  async searchProducts(query: string, limit = 10): Promise<ProductSearchResult[]> {
    const term = query.trim();
    if (this.sellerNumericId === undefined || term.length < 2) return [];

    const qLower = term.toLowerCase();
    const collected: ProductSearchResult[] = [];
    const rowsPerPage = Math.min(500, Math.max(50, limit * 40));
    const maxPages = Math.min(10, Math.ceil(2000 / rowsPerPage));

    try {
      let totalPages = maxPages;
      for (let page = 1; page <= totalPages && collected.length < limit; page++) {
        const resp = await this.httpClient.post<DigisellerSellerGoodsResponse>('seller-goods', {
          id_seller: this.sellerNumericId,
          page,
          rows: rowsPerPage,
          currency: this.listingOpts.defaultCurrency,
          lang: 'en-US',
          order_col: 'name',
          order_dir: 'asc',
          show_hidden: 0,
        });

        if (resp.retval !== 0) {
          logger.warn('Digiseller seller-goods returned non-zero retval', {
            retval: resp.retval,
            retdesc: resp.retdesc,
            page,
          });
          break;
        }

        if (typeof resp.pages === 'number' && resp.pages >= 1) {
          totalPages = Math.min(totalPages, resp.pages);
        }

        const rows = DigisellerMarketplaceAdapter.extractSellerGoodsRows(resp);
        if (rows.length === 0 && page === 1) break;

        for (const row of rows) {
          const id = row.id_goods;
          if (typeof id !== 'number') continue;

          const name = DigisellerMarketplaceAdapter.normalizeSellerGoodsName(row.name_goods);
          if (!name.toLowerCase().includes(qLower)) continue;

          const { cents, currency } = DigisellerMarketplaceAdapter.rowPriceForSearch(
            row,
            this.listingOpts.defaultCurrency,
          );

          collected.push({
            externalProductId: String(id),
            productName: name,
            platform: null,
            region: null,
            priceCents: cents,
            currency,
            available: DigisellerMarketplaceAdapter.rowLooksAvailable(row),
          });

          if (collected.length >= limit) break;
        }
      }

      return collected.slice(0, limit);
    } catch (err) {
      logger.warn('Digiseller product search failed', err as Error);
      return [];
    }
  }

  // ─── Form delivery setup ───────────────────────────────────────────

  private async setupFormDelivery(productId: number): Promise<void> {
    const callbackUrl = this.listingOpts.callbackUrl ?? '';

    if (callbackUrl.length < 8) {
      logger.error('Digiseller setupFormDelivery skipped — callbackUrl is too short or missing', {
        productId, callbackUrl,
      });
      return;
    }

    const body: Record<string, unknown> = {
      product_id: productId,
      content_type: 'Form',
      url_for_notify: callbackUrl,
      allow_purchase_multiple_items: false,
    };

    if (this.listingOpts.quantityCallbackUrl) {
      body.url_for_quantity = this.listingOpts.quantityCallbackUrl;
    }

    try {
      const resp = await this.httpClient.post<DigisellerApiResponse>(
        '/api/product/content/update/form', body,
      );
      this.assertRetval(resp, 'setupFormDelivery');
      logger.info('Digiseller form delivery configured', { productId });
    } catch (err) {
      logger.warn('Digiseller setupFormDelivery failed', {
        productId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async ensureFormDeliveryConfigured(productId: number): Promise<void> {
    try {
      const resp = await this.httpClient.get<DigisellerProductDataResponse>(
        `/api/products/${productId}/data`,
      );
      if (resp.retval === 0 && resp.product) {
        const ct = resp.product.content_type;
        if (ct === 'Form' || ct === 'form') return;
      }
    } catch {
      // continue to reconfigure
    }
    await this.setupFormDelivery(productId);
  }

  // ─── Product cloning ───────────────────────────────────────────────

  private async cloneProduct(params: CreateListingParams): Promise<CreateListingResult> {
    const sourceProductId = (params as unknown as { metadata?: Record<string, unknown> })
      .metadata?.['clone_source_product_id'] as string | undefined;
    if (!sourceProductId) {
      throw new Error('clone_source_product_id is required for clone product type');
    }

    const resp = await this.httpClient.post<DigisellerCloneProductResponse>(
      `/api/product/clone/${sourceProductId}`,
      {
        count: 1,
        categories: true,
        notify: false,
        discounts: true,
        options: true,
        comissions: true,
        gallery: true,
        payment_settings: true,
      },
    );

    this.assertRetval(resp, 'cloneProduct');
    const newProductId = resp.content.product_id;

    logger.info('Digiseller product cloned', { sourceProductId, newProductId });

    if (this.listingOpts.platiCategoryId) {
      await this.addToPlatiCategory(newProductId, this.listingOpts.platiCategoryId);
    }

    return { externalListingId: String(newProductId), status: 'active' };
  }

  // ─── Product type resolution ────────────────────────────────────────

  private resolveProductType(params: CreateListingParams): DigisellerProductType {
    const meta = (params as unknown as { metadata?: Record<string, unknown> }).metadata;
    const contentType = (meta?.['content_type'] as string | undefined) ?? this.listingOpts.contentType;
    if (contentType === 'Form') return 'arbitrary';

    const explicit = meta?.['digiseller_product_type'] as DigisellerProductType | undefined;
    if (explicit === 'clone') return 'clone';
    return explicit ?? 'uniquefixed';
  }

  private resolveEditPath(productId: number): string {
    const isForm = this.listingOpts.contentType === 'Form';
    const type = isForm ? 'arbitrary' : 'uniquefixed';
    return `/api/product/edit/${type}/${productId}`;
  }

  // ─── Create body builder ───────────────────────────────────────────

  private buildCreateBody(
    params: CreateListingParams,
    productType: Exclude<DigisellerProductType, 'clone'>,
  ): Record<string, unknown> {
    const meta = (params as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
    const nameEn = (meta['product_name'] as string | undefined) ?? `Product ${params.externalProductId}`;

    const nameEntries: Array<{ locale: string; value: string }> = [
      { locale: this.listingOpts.locale, value: nameEn },
    ];
    if (meta['product_name_ru']) {
      nameEntries.push({ locale: DIGISELLER_LOCALES[1], value: meta['product_name_ru'] as string });
    }

    const descEn = (meta['description'] as string | undefined) ?? 'Digital product key';
    const descEntries: Array<{ locale: string; value: string }> = [
      { locale: this.listingOpts.locale, value: descEn },
    ];
    if (meta['description_ru']) {
      descEntries.push({ locale: DIGISELLER_LOCALES[1], value: meta['description_ru'] as string });
    }

    const body: Record<string, unknown> = {
      content_type: productType === 'arbitrary' ? 'Form' : 'Text',
      name: nameEntries,
      price: {
        price: centsToDigiPrice(params.priceCents),
        currency: params.currency || this.listingOpts.defaultCurrency,
      },
      description: descEntries,
      guarantee: { enabled: true, value: this.listingOpts.guaranteeHours },
      enabled: true,
    };

    if (meta['categories']) {
      body.categories = meta['categories'];
    } else {
      body.categories = [{ owner: 0, category_id: 0 }];
    }

    return body;
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private async getStockCount(productId: number): Promise<number> {
    try {
      const resp = await this.httpClient.get<DigisellerCodeCountResponse>(
        `/api/products/content/code/count/${productId}`,
      );
      return resp.cnt_goods ?? 0;
    } catch (err) {
      logger.warn('Digiseller stock count query failed', {
        productId, error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  private async setProductStatus(productId: number, status: 'enabled' | 'disabled'): Promise<void> {
    const resp = await this.httpClient.post<DigisellerProductStatusResponse>(
      '/api/product/edit/V2/status',
      { new_status: status, products: [productId] },
    );
    this.assertRetval(resp, `setProductStatus(${status})`);
  }

  /**
   * Digiseller only accepts specific sales_limit values: -1, 0, 10, 50, 100, 1000.
   * Map the desired quantity to the smallest allowed value >= quantity.
   */
  private static toAllowedSalesLimit(quantity: number): number {
    if (quantity <= 0) return 0;
    const allowed = [10, 50, 100, 1000] as const;
    for (const v of allowed) {
      if (quantity <= v) return v;
    }
    return -1; // unlimited
  }

  private async updateSalesLimit(productId: number, quantity: number): Promise<void> {
    const salesLimit = DigisellerMarketplaceAdapter.toAllowedSalesLimit(quantity);
    logger.info('Digiseller updateSalesLimit', { productId, requestedQty: quantity, salesLimit });
    const resp = await this.httpClient.post<DigisellerEditProductResponse>(
      this.resolveEditPath(productId),
      { sales_limit: salesLimit },
    );
    this.assertRetval(resp, 'updateSalesLimit');
  }

  private async addToPlatiCategory(productId: number, categoryId: number): Promise<void> {
    try {
      await this.httpClient.get<unknown>(`/api/product/platform/category/add/${productId}/${categoryId}`);
      logger.info('Product added to Plati category', { productId, categoryId });
    } catch (err) {
      logger.warn('Failed to add product to Plati category', {
        productId, categoryId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private static extractSellerGoodsRows(resp: DigisellerSellerGoodsResponse): DigisellerSellerGoodsRow[] {
    const rows = resp.rows;
    if (Array.isArray(rows)) return rows;
    if (rows && typeof rows === 'object' && 'row' in rows) {
      const nested = rows.row;
      if (Array.isArray(nested)) return nested;
      if (nested && typeof nested === 'object') return [nested];
    }
    return [];
  }

  private static normalizeSellerGoodsName(raw: string | undefined): string {
    if (!raw) return '';
    return raw.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  }

  private static rowLooksAvailable(row: DigisellerSellerGoodsRow): boolean {
    if (row.in_stock === 0) return false;
    const n = row.num_in_stock;
    if (typeof n === 'number') return n > 0;
    return true;
  }

  private static rowPriceForSearch(
    row: DigisellerSellerGoodsRow,
    defaultCurrency: string,
  ): { cents: number; currency: string } {
    const currency = (row.currency ?? defaultCurrency ?? 'USD').toUpperCase();
    if (typeof row.price === 'number') {
      return { cents: floatToCents(row.price), currency };
    }
    const alt =
      currency === 'USD'
        ? row.price_usd
        : currency === 'EUR'
          ? row.price_eur
          : currency === 'RUR' || currency === 'RUB'
            ? row.price_rur
            : row.price_uah;
    if (typeof alt === 'number') return { cents: floatToCents(alt), currency };
    return { cents: 0, currency };
  }

  private assertRetval(resp: DigisellerApiResponse, operation: string): void {
    if (resp.retval !== 0) {
      let detail = `retval=${resp.retval} ${resp.retdesc ?? ''}`;
      if (resp.errors?.length) {
        const errMsgs = resp.errors.map((e) => {
          const msg = Array.isArray(e.message)
            ? e.message.map((m) => `${m.locale}: ${m.value}`).join(', ')
            : e.message;
          return `[${e.code}] ${msg}`;
        });
        detail += ` | errors: ${errMsgs.join('; ')}`;
      }
      throw new Error(`Digiseller ${operation} failed: ${detail}`);
    }
  }
}
