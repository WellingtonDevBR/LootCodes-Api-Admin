import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminOpportunitiesRepository } from '../../core/ports/admin-opportunities-repository.port.js';
import type {
  ListOpportunitiesDto,
  ListOpportunitiesResult,
  OpportunityRow,
} from '../../core/use-cases/opportunities/opportunities.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminOpportunitiesRepository');

const DEFAULT_LIMIT = 100;

const OPPORTUNITIES_SELECT = [
  'id',
  'variant_id',
  'product_id',
  'buy_provider_code',
  'buy_price_cents',
  'buy_qty',
  'sell_provider_code',
  'sell_market_floor_cents',
  'sell_commission_pct',
  'sell_fixed_fee_cents',
  'net_margin_cents',
  'net_margin_pct',
  'detected_at',
  'updated_at',
  'status',
  'products(name, image_url)',
  'product_variants(face_value, product_regions(name))',
].join(', ');

interface DbRow {
  id: string;
  variant_id: string;
  product_id: string;
  buy_provider_code: string;
  buy_price_cents: number;
  buy_qty: number | null;
  sell_provider_code: string;
  sell_market_floor_cents: number;
  sell_commission_pct: number;
  sell_fixed_fee_cents: number;
  net_margin_cents: number;
  net_margin_pct: number;
  detected_at: string;
  updated_at: string;
  status: string;
  products: { name: string; image_url: string | null } | null;
  product_variants: { face_value: string | null; product_regions: { name: string } | null } | null;
}

function variantLabel(pv: DbRow['product_variants']): string {
  if (!pv) return 'Default';
  return pv.face_value ?? pv.product_regions?.name ?? 'Default';
}

@injectable()
export class SupabaseAdminOpportunitiesRepository implements IAdminOpportunitiesRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async listOpportunities(dto: ListOpportunitiesDto): Promise<ListOpportunitiesResult> {
    logger.info('Listing arbitrage opportunities', {
      status: dto.status,
      minMargin: dto.min_margin_pct,
    });

    const status = dto.status ?? 'open';
    const limit = dto.limit ?? DEFAULT_LIMIT;
    const offset = dto.offset ?? 0;

    const eq: Array<[string, unknown]> = [['status', status]];
    if (dto.buy_provider) eq.push(['buy_provider_code', dto.buy_provider]);
    if (dto.sell_provider) eq.push(['sell_provider_code', dto.sell_provider]);

    const gte: Array<[string, unknown]> = [];
    if (dto.min_margin_pct !== undefined && dto.min_margin_pct > 0) {
      gte.push(['net_margin_pct', dto.min_margin_pct]);
    }

    const { data: rows, total } = await this.db.queryPaginated<DbRow>(
      'arbitrage_opportunities',
      {
        select: OPPORTUNITIES_SELECT,
        eq,
        gte: gte.length > 0 ? gte : undefined,
        order: { column: 'net_margin_pct', ascending: false },
        range: [offset, offset + limit - 1],
      },
    );

    const opportunities: OpportunityRow[] = rows.map((r) => ({
      opportunity_id: r.id,
      variant_id: r.variant_id,
      product_id: r.product_id,
      product_name: r.products?.name ?? 'Unknown',
      product_image_url: r.products?.image_url ?? null,
      variant_label: variantLabel(r.product_variants),
      buy_provider_code: r.buy_provider_code,
      buy_price_cents: r.buy_price_cents,
      buy_qty: r.buy_qty,
      sell_provider_code: r.sell_provider_code,
      sell_market_floor_cents: r.sell_market_floor_cents,
      sell_commission_pct: Number(r.sell_commission_pct),
      sell_fixed_fee_cents: r.sell_fixed_fee_cents,
      net_margin_cents: r.net_margin_cents,
      net_margin_pct: Number(r.net_margin_pct),
      detected_at: r.detected_at,
      updated_at: r.updated_at,
      status: r.status,
    }));

    return { opportunities, total_count: total };
  }
}
