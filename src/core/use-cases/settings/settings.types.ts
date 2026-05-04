// ── Entity types ────────────────────────────────────────────────────

export interface Language {
  id: string;
  name: string;
  code: string;
  native_name: string | null;
  is_active: boolean;
}

export interface Country {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

export interface Region {
  id: string;
  name: string;
  code: string;
  is_global: boolean;
  restrictions: string | null;
  created_at: string;
}

export interface ExcludedCountry {
  country_code: string;
  country_name: string;
}

export interface PlatformFamily {
  id: string;
  code: string;
  name: string;
  slug: string;
  icon_url: string | null;
  display_order: number;
}

export interface Platform {
  id: string;
  name: string;
  code: string;
  slug: string;
  icon_url: string | null;
  default_instructions: string | null;
  display_order: number | null;
  family_id: string | null;
  redemption_url_template: string | null;
  key_display_label: string | null;
}

export interface Genre {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
}

// ── DTOs — Languages ────────────────────────────────────────────────

export interface CreateLanguageDto {
  name: string;
  code: string;
  native_name?: string;
}

export interface UpdateLanguageDto {
  name?: string;
  code?: string;
  native_name?: string;
  is_active?: boolean;
}

// ── DTOs — Countries ────────────────────────────────────────────────

export interface CreateCountryDto {
  name: string;
  code: string;
}

export interface UpdateCountryDto {
  name?: string;
  code?: string;
  is_active?: boolean;
}

// ── DTOs — Regions ──────────────────────────────────────────────────

export interface CreateRegionDto {
  name: string;
  code: string;
  is_global?: boolean;
  restrictions?: string;
}

export interface UpdateRegionDto {
  name?: string;
  code?: string;
  is_global?: boolean;
  restrictions?: string;
  excluded_country_codes?: string[];
}

// ── DTOs — Platform Families ────────────────────────────────────────

export interface CreatePlatformFamilyDto {
  name: string;
  code: string;
  slug: string;
}

export interface UpdatePlatformFamilyDto {
  name?: string;
  code?: string;
  slug?: string;
  icon_url?: string | null;
}

// ── DTOs — Platforms ────────────────────────────────────────────────

export interface CreatePlatformDto {
  name: string;
  code: string;
  slug: string;
  icon_url?: string | null;
  default_instructions?: string | null;
  redemption_url_template?: string | null;
  key_display_label?: string | null;
}

export interface UpdatePlatformDto {
  name?: string;
  code?: string;
  icon_url?: string | null;
  default_instructions?: string | null;
  family_id?: string | null;
  redemption_url_template?: string | null;
  key_display_label?: string | null;
}

// ── DTOs — Genres ───────────────────────────────────────────────────

export interface CreateGenreDto {
  name: string;
  slug?: string;
}

export interface UpdateGenreDto {
  name?: string;
  slug?: string;
  sort_order?: number;
}

// ── DTOs — Platform Settings (General / Payments JSONB) ─────────────

export interface ListSettingsDto { category?: string }
export interface ListSettingsResult { settings: unknown[] }
export interface UpdateSettingDto { key: string; value: unknown; admin_id: string }
export interface UpdateSettingResult { success: boolean }
