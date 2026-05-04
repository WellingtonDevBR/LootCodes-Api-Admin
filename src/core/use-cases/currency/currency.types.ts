// ── Entity ──────────────────────────────────────────────────────────

export interface CurrencyRate {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  margin_pct: number;
  last_updated: string;
  source: string;
  is_active: boolean;
}

// ── DTOs ────────────────────────────────────────────────────────────

export interface AddCurrencyRateDto {
  to_currency: string;
  rate: number;
  admin_id: string;
}

export interface UpdateCurrencyRateDto {
  id: string;
  rate: number;
  admin_id: string;
}

export interface UpdateCurrencyMarginDto {
  id: string;
  margin_pct: number;
  admin_id: string;
}

export interface ToggleCurrencyActiveDto {
  id: string;
  admin_id: string;
}

export interface DeleteCurrencyRateDto {
  id: string;
  admin_id: string;
}

export interface SyncCurrencyDto {
  admin_id: string;
}

export interface GenerateAllPricesDto {
  admin_id: string;
}

// ── Results ─────────────────────────────────────────────────────────

export interface SyncCurrencyResult {
  success: boolean;
  message?: string;
}

export interface GenerateAllPricesResult {
  success: boolean;
  inserted?: number;
  updated?: number;
  errors?: number;
  message?: string;
}
