import type {
  Language, CreateLanguageDto, UpdateLanguageDto,
  Country, CreateCountryDto, UpdateCountryDto,
  Region, CreateRegionDto, UpdateRegionDto, ExcludedCountry,
  PlatformFamily, CreatePlatformFamilyDto, UpdatePlatformFamilyDto,
  Platform, CreatePlatformDto, UpdatePlatformDto,
  Genre, CreateGenreDto, UpdateGenreDto,
  ListSettingsDto, ListSettingsResult,
  UpdateSettingDto, UpdateSettingResult,
} from '../use-cases/settings/settings.types.js';

export interface IAdminSettingsRepository {
  // Platform settings (JSONB key-value)
  listSettings(dto: ListSettingsDto): Promise<ListSettingsResult>;
  updateSetting(dto: UpdateSettingDto): Promise<UpdateSettingResult>;
  getPlatformSettings(): Promise<Record<string, unknown>>;

  // Languages
  listLanguages(): Promise<Language[]>;
  createLanguage(dto: CreateLanguageDto): Promise<Language>;
  updateLanguage(id: string, dto: UpdateLanguageDto): Promise<Language>;

  // Countries
  listCountries(): Promise<Country[]>;
  createCountry(dto: CreateCountryDto): Promise<Country>;
  updateCountry(id: string, dto: UpdateCountryDto): Promise<Country>;

  // Regions
  listRegions(): Promise<Region[]>;
  createRegion(dto: CreateRegionDto): Promise<Region>;
  updateRegion(id: string, dto: UpdateRegionDto): Promise<Region>;
  getRegionExcludedCountries(regionId: string): Promise<ExcludedCountry[]>;

  // Platform families
  listPlatformFamilies(): Promise<PlatformFamily[]>;
  createPlatformFamily(dto: CreatePlatformFamilyDto): Promise<PlatformFamily>;
  updatePlatformFamily(id: string, dto: UpdatePlatformFamilyDto): Promise<PlatformFamily>;
  deletePlatformFamily(id: string): Promise<void>;

  // Platforms
  listPlatforms(): Promise<Platform[]>;
  createPlatform(dto: CreatePlatformDto): Promise<Platform>;
  updatePlatform(id: string, dto: UpdatePlatformDto): Promise<Platform>;

  // Genres
  listGenres(): Promise<Genre[]>;
  createGenre(dto: CreateGenreDto): Promise<Genre>;
  updateGenre(id: string, dto: UpdateGenreDto): Promise<Genre>;
  deleteGenre(id: string): Promise<void>;
}
