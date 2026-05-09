import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IStorage } from '../../core/ports/storage.port.js';
import type { IAdminPriceMatchRepository } from '../../core/ports/admin-price-match-repository.port.js';
import type {
  ListClaimsDto,
  ListClaimsResult,
  PriceMatchClaimRow,
  ClaimConfidenceResult,
  RiskFlag,
  ApprovePriceMatchDto,
  ApprovePriceMatchResult,
  RejectPriceMatchDto,
  RejectPriceMatchResult,
  PreviewPriceMatchDiscountDto,
  PreviewPriceMatchDiscountResult,
  GetScreenshotUrlResult,
  TrustedRetailerRow,
  CreateRetailerDto,
  UpdateRetailerDto,
  BlockedDomainRow,
  CreateBlockedDomainDto,
  UpdateBlockedDomainDto,
  PriceMatchConfigResult,
  UpdatePriceMatchConfigDto,
  ExpirePriceMatchClaimsResult,
  ProcessPriceDropRefundsResult,
} from '../../core/use-cases/price-match/price-match.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminPriceMatchRepository');

const CLAIM_SELECT = `
  id, status, user_id, guest_email, product_id, variant_id,
  retailer_id, competitor_host, competitor_url,
  competitor_price_cents, competitor_currency, competitor_price_usd_cents,
  screenshot_path, our_price_usd_cents, our_price_display_cents,
  display_currency, exchange_rate_used,
  discount_type, discount_value, beat_percentage, promo_code_id,
  rejection_reason, reviewed_by, reviewed_at, review_notes,
  ip_address, fingerprint_hash, expires_at, created_at, updated_at
`.replace(/\n/g, '').trim();

interface CurrencyRateRow {
  rate: number;
  margin_pct: number | null;
}

@injectable()
export class SupabaseAdminPriceMatchRepository implements IAdminPriceMatchRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.Storage) private storage: IStorage,
  ) {}

  // ── Claims ─────────────────────────────────────────────────────────────

  async listClaims(dto: ListClaimsDto): Promise<ListClaimsResult> {
    const limit = dto.limit ?? 25;
    const offset = dto.offset ?? 0;

    const eq: Array<[string, unknown]> = [];
    if (dto.status) eq.push(['status', dto.status]);
    if (dto.user_id) eq.push(['user_id', dto.user_id]);

    const ilike: Array<[string, string]> | undefined = dto.guest_email
      ? [['guest_email', `%${dto.guest_email}%`]]
      : undefined;

    const result = await this.db.queryPaginated<PriceMatchClaimRow>('price_match_claims', {
      select: CLAIM_SELECT,
      eq: eq.length > 0 ? eq : undefined,
      ilike,
      order: { column: 'created_at', ascending: false },
      range: [offset, offset + limit - 1],
    });

    return { entries: result.data, total: result.total };
  }

  async getClaimDetail(claimId: string): Promise<PriceMatchClaimRow | null> {
    const claim = await this.db.queryOne<PriceMatchClaimRow>('price_match_claims', {
      select: CLAIM_SELECT,
      filter: { id: claimId },
    });

    if (!claim) return null;

    const [product, variant, retailer] = await Promise.all([
      this.db.queryOne<{ name: string; slug: string; image_url: string | null }>('products', {
        select: 'name, slug, image_url',
        filter: { id: claim.product_id },
      }),
      this.db.queryOne<{ id: string; price_usd: number }>('product_variants', {
        select: 'id, price_usd',
        filter: { id: claim.variant_id },
      }),
      claim.retailer_id
        ? this.db.queryOne<{ name: string; domain: string; category: string }>('price_match_trusted_retailers', {
            select: 'name, domain, category',
            filter: { id: claim.retailer_id },
          })
        : Promise.resolve(null),
    ]);

    return { ...claim, product, variant, retailer };
  }

  async getClaimConfidence(claimId: string): Promise<ClaimConfidenceResult | null> {
    const claim = await this.db.queryOne<PriceMatchClaimRow>('price_match_claims', {
      select: 'id, user_id, guest_email, competitor_host, our_price_usd_cents, competitor_price_usd_cents, variant_id, ip_address, fingerprint_hash, created_at',
      filter: { id: claimId },
    });
    if (!claim) return null;

    const riskFlags: RiskFlag[] = [];
    let score = 50;

    const retailer = await this.db.queryOne<{ category: string }>('price_match_trusted_retailers', {
      select: 'category',
      filter: { domain: claim.competitor_host, is_active: true },
    });

    const retailerTier = retailer?.category ?? 'unknown';

    if (retailerTier === 'official') { score += 30; }
    else if (retailerTier === 'authorized') { score += 15; }
    else if (retailerTier === 'unknown') {
      score -= 20;
      riskFlags.push({ key: 'unknown_retailer', label: 'Unknown retailer', severity: 'yellow' });
    }

    const blocked = await this.db.queryOne<{ id: string }>('price_match_blocked_domains', {
      select: 'id',
      filter: { domain: claim.competitor_host, is_active: true },
    });
    if (blocked) {
      score -= 40;
      riskFlags.push({ key: 'blocked_domain', label: 'Blocked domain', severity: 'red' });
    }

    const costOffer = await this.db.query<{ last_price_cents: number }>('provider_variant_offers', {
      select: 'last_price_cents',
      eq: [['variant_id', claim.variant_id], ['is_active', true]],
      gt: [['last_price_cents', 0]],
      order: { column: 'last_price_cents', ascending: true },
      limit: 1,
    });
    const costFloor = costOffer.length > 0 ? costOffer[0].last_price_cents : null;

    if (costFloor && claim.competitor_price_usd_cents < costFloor) {
      score -= 25;
      riskFlags.push({ key: 'below_cost', label: 'Competitor price below our procurement cost', severity: 'red' });
    }

    let userOrderCount = 0;
    let accountAgeDays = 0;
    if (claim.user_id) {
      const orders = await this.db.query<{ id: string }>('orders', {
        select: 'id',
        filter: { user_id: claim.user_id, status: 'completed' },
      });
      userOrderCount = orders.length;
      if (userOrderCount >= 3) score += 10;

      const profile = await this.db.queryOne<{ created_at: string }>('profiles', {
        select: 'created_at',
        filter: { id: claim.user_id },
      });
      if (profile) {
        accountAgeDays = Math.floor((Date.now() - new Date(profile.created_at).getTime()) / 86_400_000);
        if (accountAgeDays < 7) {
          score -= 10;
          riskFlags.push({ key: 'new_account', label: 'Account less than 7 days old', severity: 'yellow' });
        }
      }
    } else {
      riskFlags.push({ key: 'guest_user', label: 'Guest user (no account history)', severity: 'yellow' });
      score -= 5;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayClaims = await this.db.query<{ id: string }>('price_match_claims', {
      select: 'id',
      eq: claim.user_id
        ? [['user_id', claim.user_id]]
        : [['guest_email', claim.guest_email ?? '']],
      gte: [['created_at', todayStart.toISOString()]],
    });
    const claimCountToday = todayClaims.length;
    if (claimCountToday > 3) {
      score -= 15;
      riskFlags.push({ key: 'high_frequency', label: `${claimCountToday} claims today`, severity: 'yellow' });
    }

    const clampedScore = Math.max(0, Math.min(100, score));
    const level = clampedScore >= 70 ? 'HIGH' : clampedScore >= 40 ? 'MEDIUM' : 'LOW';

    return {
      score: clampedScore,
      level,
      retailerTier,
      riskFlags,
      costFloor,
      userOrderCount,
      accountAgeDays,
      claimCountToday,
    };
  }

  async getScreenshotUrl(screenshotPath: string): Promise<GetScreenshotUrlResult> {
    const url = await this.storage.createSignedUrl('price-match-evidence', screenshotPath, 300);
    return { url };
  }

  // ── Approve ────────────────────────────────────────────────────────────

  async approvePriceMatch(dto: ApprovePriceMatchDto): Promise<ApprovePriceMatchResult> {
    logger.info('Approving price match claim', { claimId: dto.claim_id });

    const claim = await this.db.queryOne<PriceMatchClaimRow>('price_match_claims', {
      select: '*',
      filter: { id: dto.claim_id },
    });

    if (!claim) return { success: false, error: 'Claim not found' };
    if (claim.status !== 'pending' && claim.status !== 'expired') {
      return { success: false, error: `Claim already ${claim.status}` };
    }

    const configRow = await this.db.queryOne<{ config_value: Record<string, unknown> }>('security_config', {
      select: 'config_value',
      filter: { config_key: 'price_match_config' },
    });
    const config = configRow?.config_value ?? {};
    const maxDiscountUsdCents = Number(config.max_discount_usd_cents ?? 5000);
    const promoExpiryHours = Number(config.promo_expiry_hours ?? 72);
    const minMarginCents = Number(config.min_margin_usd_cents ?? 100);
    const marginBlockAtCost = config.margin_block_at_cost !== false;

    const rawDisplayCurrency = claim.display_currency || 'USD';

    if (dto.discount_type === 'percentage') {
      if (dto.discount_value > 100) return { success: false, error: 'Percentage cannot exceed 100' };
    }

    let fixedDiscountUsdCents = 0;
    if (dto.discount_type === 'fixed_amount') {
      const promoDiscountCurrency = await this.resolvePromoDiscountCurrency(dto.discount_type, rawDisplayCurrency);
      if (promoDiscountCurrency.error) return { success: false, error: promoDiscountCurrency.error };

      const conv = await this.foreignMinorToUsdCents(promoDiscountCurrency.currency, dto.discount_value);
      if (conv === null) return { success: false, error: 'Could not convert discount to USD for validation' };
      fixedDiscountUsdCents = conv;
      if (fixedDiscountUsdCents > maxDiscountUsdCents) {
        return { success: false, error: `Discount exceeds maximum of ${maxDiscountUsdCents} USD cents (equivalent)` };
      }
    }

    const costOffers = await this.db.query<{ last_price_cents: number }>('provider_variant_offers', {
      select: 'last_price_cents',
      eq: [['variant_id', claim.variant_id], ['is_active', true]],
      gt: [['last_price_cents', 0]],
      order: { column: 'last_price_cents', ascending: true },
      limit: 1,
    });
    const costFloor = costOffers.length > 0 ? costOffers[0].last_price_cents : null;

    if (costFloor !== null) {
      let effectivePrice = claim.our_price_usd_cents;
      if (dto.discount_type === 'fixed_amount') {
        effectivePrice -= fixedDiscountUsdCents;
      } else {
        effectivePrice -= Math.round(effectivePrice * dto.discount_value / 100);
      }

      if (marginBlockAtCost && effectivePrice <= costFloor) {
        return { success: false, error: 'Discount would sell below procurement cost' };
      }

      if (effectivePrice < costFloor + minMarginCents) {
        logger.warn('Price match approval below minimum margin', { claimId: dto.claim_id, costFloor, effectivePrice });
      }
    }

    const codeId = randomUUID();
    const codeStr = `PRICEMATCH-${randomUUID().slice(0, 6).toUpperCase()}`;

    const targetAudience = claim.user_id
      ? { type: 'specific_users', user_ids: [claim.user_id] }
      : { type: 'specific_users', emails: [claim.guest_email] };

    const now = new Date().toISOString();
    const validUntil = new Date(Date.now() + promoExpiryHours * 3600_000).toISOString();

    const promoDiscountCurrency = dto.discount_type === 'percentage'
      ? 'USD'
      : (await this.resolvePromoDiscountCurrency(dto.discount_type, rawDisplayCurrency)).currency;

    try {
      await this.db.insert('promo_codes', {
        id: codeId,
        code: codeStr,
        name: `Price match — ${claim.product_id}`,
        discount_type: dto.discount_type,
        discount_value: dto.discount_value,
        discount_currency: promoDiscountCurrency,
        scope: 'specific_products',
        max_uses: 1,
        max_uses_per_user: 1,
        stackable: false,
        auto_apply: false,
        target_audience: targetAudience,
        valid_from: now,
        valid_until: validUntil,
        approval_status: 'approved',
        is_active: true,
        created_by: dto.admin_id,
        max_discount_cents: dto.discount_type === 'fixed_amount' ? dto.discount_value : null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('23505')) return { success: false, error: 'Promo code collision — please retry' };
      logger.error('Failed to create promo code', { error: message, claimId: dto.claim_id });
      return { success: false, error: 'Failed to create promo code' };
    }

    try {
      await this.db.insert('promo_code_products', { promo_code_id: codeId, product_id: claim.product_id });
    } catch (err: unknown) {
      logger.error('Failed to link promo to product', { error: err instanceof Error ? err.message : String(err) });
    }

    const beatPct = claim.our_price_usd_cents > 0
      ? ((claim.our_price_usd_cents - claim.competitor_price_usd_cents) / claim.our_price_usd_cents * 100)
      : 0;

    await this.db.update('price_match_claims', { id: dto.claim_id }, {
      status: 'approved',
      promo_code_id: codeId,
      discount_type: dto.discount_type,
      discount_value: dto.discount_value,
      beat_percentage: Math.round(beatPct * 100) / 100,
      reviewed_by: dto.admin_id,
      reviewed_at: now,
      review_notes: dto.admin_notes ?? null,
      updated_at: now,
    });

    await this.logAdminAction(dto.admin_id, 'approve_price_match', 'price_match_claim', dto.claim_id, {
      discount_type: dto.discount_type,
      discount_value: dto.discount_value,
      promo_code: codeStr,
      product_id: claim.product_id,
      notes: dto.admin_notes ?? null,
    });

    await this.emitDomainEvent('price_match.claim_resolved', 'price_match_claim', dto.claim_id, {
      claim_id: dto.claim_id,
      status: 'approved',
      user_id: claim.user_id,
      guest_email: claim.guest_email,
      product_id: claim.product_id,
      promo_code: codeStr,
    });

    return { success: true, promo_code: codeStr };
  }

  // ── Reject ─────────────────────────────────────────────────────────────

  async rejectPriceMatch(dto: RejectPriceMatchDto): Promise<RejectPriceMatchResult> {
    logger.info('Rejecting price match claim', { claimId: dto.claim_id });

    const claim = await this.db.queryOne<{ id: string; status: string; user_id: string | null; guest_email: string | null; product_id: string }>('price_match_claims', {
      select: 'id, status, user_id, guest_email, product_id',
      filter: { id: dto.claim_id },
    });

    if (!claim) return { success: false, error: 'Claim not found' };
    if (claim.status !== 'pending' && claim.status !== 'expired') {
      return { success: false, error: `Claim already ${claim.status}` };
    }

    const now = new Date().toISOString();

    await this.db.update('price_match_claims', { id: dto.claim_id }, {
      status: 'rejected',
      rejection_reason: dto.rejection_reason,
      reviewed_by: dto.admin_id,
      reviewed_at: now,
      review_notes: dto.admin_notes ?? null,
      updated_at: now,
    });

    await this.logAdminAction(dto.admin_id, 'reject_price_match', 'price_match_claim', dto.claim_id, {
      rejection_reason: dto.rejection_reason,
      product_id: claim.product_id,
      notes: dto.admin_notes ?? null,
    });

    await this.emitDomainEvent('price_match.claim_resolved', 'price_match_claim', dto.claim_id, {
      claim_id: dto.claim_id,
      status: 'rejected',
      user_id: claim.user_id,
      guest_email: claim.guest_email,
      product_id: claim.product_id,
    });

    return { success: true };
  }

  // ── Preview Discount (FX) ──────────────────────────────────────────────

  async previewDiscount(dto: PreviewPriceMatchDiscountDto): Promise<PreviewPriceMatchDiscountResult> {
    if (dto.discount_minor !== undefined) {
      const usdCents = await this.foreignMinorToUsdCents(dto.currency, Math.round(dto.discount_minor));
      if (usdCents === null) return {};
      return { usd_cents_equivalent: usdCents };
    }

    if (dto.usd_cents !== undefined) {
      const discountMinor = await this.usdCentsToForeignMinor(dto.currency, Math.round(dto.usd_cents));
      if (discountMinor === null) return {};
      return { discount_minor: discountMinor };
    }

    return {};
  }

  // ── Trusted Retailers ──────────────────────────────────────────────────

  async listRetailers(): Promise<TrustedRetailerRow[]> {
    return this.db.query<TrustedRetailerRow>('price_match_trusted_retailers', {
      select: 'id, name, domain, category, is_active',
      order: { column: 'name', ascending: true },
    });
  }

  async createRetailer(dto: CreateRetailerDto): Promise<string | null> {
    try {
      const row = await this.db.insert<{ id: string }>('price_match_trusted_retailers', {
        name: dto.name,
        domain: dto.domain,
        category: dto.category,
        is_active: true,
      });
      return row.id;
    } catch {
      return null;
    }
  }

  async updateRetailer(dto: UpdateRetailerDto): Promise<boolean> {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.domain !== undefined) data.domain = dto.domain;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;

    if (Object.keys(data).length === 0) return true;

    const rows = await this.db.update('price_match_trusted_retailers', { id: dto.id }, data);
    return rows.length > 0;
  }

  // ── Blocked Domains ────────────────────────────────────────────────────

  async listBlockedDomains(): Promise<BlockedDomainRow[]> {
    return this.db.query<BlockedDomainRow>('price_match_blocked_domains', {
      select: 'id, domain, is_active, notes, created_at, updated_at',
      order: { column: 'domain', ascending: true },
    });
  }

  async createBlockedDomain(dto: CreateBlockedDomainDto): Promise<string | null> {
    try {
      const row = await this.db.insert<{ id: string }>('price_match_blocked_domains', {
        domain: dto.domain,
        is_active: true,
        notes: dto.notes ?? null,
      });
      return row.id;
    } catch {
      return null;
    }
  }

  async updateBlockedDomain(dto: UpdateBlockedDomainDto): Promise<boolean> {
    const data: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.domain !== undefined) data.domain = dto.domain;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const rows = await this.db.update('price_match_blocked_domains', { id: dto.id }, data);
    return rows.length > 0;
  }

  // ── Config ─────────────────────────────────────────────────────────────

  async getConfig(): Promise<PriceMatchConfigResult> {
    const row = await this.db.queryOne<{ config_value: Record<string, unknown> }>('security_config', {
      select: 'config_value',
      filter: { config_key: 'price_match_config' },
    });
    return { config: row?.config_value ?? null };
  }

  async updateConfig(dto: UpdatePriceMatchConfigDto): Promise<boolean> {
    try {
      await this.db.upsert('security_config', {
        config_key: 'price_match_config',
        config_value: dto.config,
        updated_at: new Date().toISOString(),
      }, 'config_key');

      await this.logAdminAction(dto.admin_id, 'update_price_match_config', 'security_config', 'price_match_config', {
        config: dto.config,
      });

      return true;
    } catch {
      return false;
    }
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private async resolvePromoDiscountCurrency(
    discountType: string,
    rawCurrency: string,
  ): Promise<{ error: string | null; currency: string }> {
    const c = (rawCurrency || 'USD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return { error: 'Invalid currency', currency: 'USD' };
    if (discountType === 'percentage') return { error: null, currency: 'USD' };
    if (c === 'USD') return { error: null, currency: 'USD' };

    const row = await this.db.queryOne<{ to_currency: string }>('currency_rates', {
      select: 'to_currency',
      eq: [['from_currency', 'USD'], ['to_currency', c], ['is_active', true]],
    });
    if (!row) return { error: `Unsupported or inactive checkout currency: ${c}`, currency: c };
    return { error: null, currency: c };
  }

  private async foreignMinorToUsdCents(currency: string, minor: number): Promise<number | null> {
    const c = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return null;
    if (c === 'USD') return Math.round(minor);

    const row = await this.db.queryOne<CurrencyRateRow>('currency_rates', {
      select: 'rate, margin_pct',
      eq: [['from_currency', 'USD'], ['to_currency', c], ['is_active', true]],
    });
    if (!row || typeof row.rate !== 'number' || row.rate <= 0) return null;
    const margin = Number(row.margin_pct) || 0;
    const rateEff = row.rate * (1 + margin / 100);
    return Math.round(minor / rateEff);
  }

  private async usdCentsToForeignMinor(currency: string, usdCents: number): Promise<number | null> {
    const c = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return null;
    if (c === 'USD') return Math.round(usdCents);

    const row = await this.db.queryOne<CurrencyRateRow>('currency_rates', {
      select: 'rate, margin_pct',
      eq: [['from_currency', 'USD'], ['to_currency', c], ['is_active', true]],
    });
    if (!row || typeof row.rate !== 'number' || row.rate <= 0) return null;
    const margin = Number(row.margin_pct) || 0;
    const rateEff = row.rate * (1 + margin / 100);
    return Math.round(usdCents * rateEff);
  }

  private async logAdminAction(
    adminId: string,
    actionType: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.db.insert('admin_actions', {
        admin_user_id: adminId,
        action_type: actionType,
        target_type: targetType,
        target_id: targetId,
        details,
      });
    } catch (err: unknown) {
      logger.error('Failed to log admin action', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Cron operations ──────────────────────────────────────────────────────

  async expireStaleClaims(): Promise<ExpirePriceMatchClaimsResult> {
    const expiredCount = await this.db.rpc<number>('expire_stale_price_match_claims');
    return { expiredCount: expiredCount ?? 0 };
  }

  async processPriceDropRefunds(): Promise<ProcessPriceDropRefundsResult> {
    const grantedCount = await this.db.rpc<number>('process_price_drop_refunds');
    return { grantedCount: grantedCount ?? 0 };
  }

  private async emitDomainEvent(
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.db.insert('domain_events', {
        event_type: eventType,
        aggregate_type: aggregateType,
        aggregate_id: aggregateId,
        payload,
        version: 1,
      });
    } catch (err: unknown) {
      logger.error('Failed to emit domain event', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
