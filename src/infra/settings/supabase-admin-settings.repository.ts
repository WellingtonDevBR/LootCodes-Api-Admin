import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminSettingsRepository } from '../../core/ports/admin-settings-repository.port.js';
import type {
  Language, CreateLanguageDto, UpdateLanguageDto,
  Country, CreateCountryDto, UpdateCountryDto,
  Region, CreateRegionDto, UpdateRegionDto, ExcludedCountry,
  PlatformFamily, CreatePlatformFamilyDto, UpdatePlatformFamilyDto,
  Platform, CreatePlatformDto, UpdatePlatformDto,
  Genre, CreateGenreDto, UpdateGenreDto,
  ListSettingsDto, ListSettingsResult,
  UpdateSettingDto, UpdateSettingResult,
} from '../../core/use-cases/settings/settings.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminSettingsRepository');

function buildPartialUpdate(dto: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    if (dto[key] !== undefined) data[key] = dto[key];
  }
  return data;
}

@injectable()
export class SupabaseAdminSettingsRepository implements IAdminSettingsRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  // ── Platform settings (JSONB key-value) ───────────────────────────

  async listSettings(_dto: ListSettingsDto): Promise<ListSettingsResult> {
    const rows = await this.db.query<{ key: string; value: unknown }>(
      'platform_settings',
      { select: 'key, value' },
    );
    return { settings: rows };
  }

  async updateSetting(dto: UpdateSettingDto): Promise<UpdateSettingResult> {
    logger.info('Updating setting', { key: dto.key, adminId: dto.admin_id });
    await this.db.upsert('platform_settings', {
      key: dto.key,
      value: dto.value,
      updated_at: new Date().toISOString(),
    }, 'key');
    return { success: true };
  }

  async getPlatformSettings(): Promise<Record<string, unknown>> {
    const rows = await this.db.query<{ key: string; value: unknown }>(
      'platform_settings',
      { select: 'key, value' },
    );
    const map: Record<string, unknown> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }
    return map;
  }

  // ── Languages ─────────────────────────────────────────────────────

  async listLanguages(): Promise<Language[]> {
    return this.db.query<Language>('languages', {
      select: 'id, name, code, native_name, is_active',
      order: { column: 'name', ascending: true },
    });
  }

  async createLanguage(dto: CreateLanguageDto): Promise<Language> {
    return this.db.insert<Language>('languages', {
      name: dto.name,
      code: dto.code,
      native_name: dto.native_name ?? null,
    });
  }

  async updateLanguage(id: string, dto: UpdateLanguageDto): Promise<Language> {
    const data = buildPartialUpdate(dto as Record<string, unknown>, ['name', 'code', 'native_name', 'is_active']);
    const rows = await this.db.update<Language>('languages', { id }, data);
    return rows[0];
  }

  // ── Countries ─────────────────────────────────────────────────────

  async listCountries(): Promise<Country[]> {
    return this.db.query<Country>('countries', {
      select: 'id, name, code, is_active',
      order: { column: 'name', ascending: true },
    });
  }

  async createCountry(dto: CreateCountryDto): Promise<Country> {
    return this.db.insert<Country>('countries', {
      name: dto.name,
      code: dto.code,
    });
  }

  async updateCountry(id: string, dto: UpdateCountryDto): Promise<Country> {
    const data = buildPartialUpdate(dto as Record<string, unknown>, ['name', 'code', 'is_active']);
    const rows = await this.db.update<Country>('countries', { id }, data);
    return rows[0];
  }

  // ── Regions ───────────────────────────────────────────────────────

  async listRegions(): Promise<Region[]> {
    return this.db.query<Region>('product_regions', {
      select: 'id, name, code, is_global, restrictions, created_at',
      order: { column: 'name', ascending: true },
    });
  }

  async createRegion(dto: CreateRegionDto): Promise<Region> {
    return this.db.insert<Region>('product_regions', {
      name: dto.name,
      code: dto.code,
      is_global: dto.is_global ?? false,
      restrictions: dto.restrictions ?? null,
    });
  }

  async updateRegion(id: string, dto: UpdateRegionDto): Promise<Region> {
    const data = buildPartialUpdate(dto as Record<string, unknown>, ['name', 'code', 'is_global', 'restrictions']);
    const rows = await this.db.update<Region>('product_regions', { id }, data);

    if (dto.excluded_country_ids !== undefined) {
      await this.db.delete('region_country_exclusions', { region_id: id });
      for (const countryId of dto.excluded_country_ids) {
        await this.db.insert('region_country_exclusions', {
          region_id: id,
          country_id: countryId,
        });
      }
    }

    return rows[0];
  }

  async getRegionExcludedCountries(regionId: string): Promise<ExcludedCountry[]> {
    return this.db.rpc<ExcludedCountry[]>(
      'get_excluded_countries_for_region',
      { p_region_id: regionId },
    );
  }

  // ── Platform families ─────────────────────────────────────────────

  async listPlatformFamilies(): Promise<PlatformFamily[]> {
    return this.db.query<PlatformFamily>('platform_families', {
      select: 'id, code, name, slug, icon_url, display_order',
      order: { column: 'display_order', ascending: true },
    });
  }

  async createPlatformFamily(dto: CreatePlatformFamilyDto): Promise<PlatformFamily> {
    return this.db.insert<PlatformFamily>('platform_families', {
      name: dto.name,
      code: dto.code,
      slug: dto.slug,
    });
  }

  async updatePlatformFamily(id: string, dto: UpdatePlatformFamilyDto): Promise<PlatformFamily> {
    const data = buildPartialUpdate(dto as Record<string, unknown>, ['name', 'code', 'slug', 'icon_url']);
    const rows = await this.db.update<PlatformFamily>('platform_families', { id }, data);
    return rows[0];
  }

  async deletePlatformFamily(id: string): Promise<void> {
    await this.db.delete('platform_families', { id });
  }

  // ── Platforms ─────────────────────────────────────────────────────

  async listPlatforms(): Promise<Platform[]> {
    return this.db.query<Platform>('product_platforms', {
      select: 'id, name, code, slug, icon_url, default_instructions, family_id, redemption_url_template, key_display_label',
      order: { column: 'name', ascending: true },
    });
  }

  async createPlatform(dto: CreatePlatformDto): Promise<Platform> {
    return this.db.insert<Platform>('product_platforms', {
      name: dto.name,
      code: dto.code,
      slug: dto.slug,
      icon_url: dto.icon_url ?? null,
      default_instructions: dto.default_instructions ?? null,
      redemption_url_template: dto.redemption_url_template ?? null,
      key_display_label: dto.key_display_label ?? null,
    });
  }

  async updatePlatform(id: string, dto: UpdatePlatformDto): Promise<Platform> {
    const data = buildPartialUpdate(dto as Record<string, unknown>, [
      'name', 'code', 'icon_url', 'default_instructions',
      'family_id', 'redemption_url_template', 'key_display_label',
    ]);
    const rows = await this.db.update<Platform>('product_platforms', { id }, data);
    return rows[0];
  }

  // ── Genres ────────────────────────────────────────────────────────

  async listGenres(): Promise<Genre[]> {
    return this.db.query<Genre>('genres', {
      select: 'id, name, slug, sort_order',
      order: { column: 'sort_order', ascending: true },
    });
  }

  async createGenre(dto: CreateGenreDto): Promise<Genre> {
    const slug = dto.slug ?? dto.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return this.db.insert<Genre>('genres', {
      name: dto.name,
      slug,
    });
  }

  async updateGenre(id: string, dto: UpdateGenreDto): Promise<Genre> {
    const data = buildPartialUpdate(dto as Record<string, unknown>, ['name', 'slug', 'sort_order']);
    const rows = await this.db.update<Genre>('genres', { id }, data);
    return rows[0];
  }

  async deleteGenre(id: string): Promise<void> {
    await this.db.delete('genres', { id });
  }
}
