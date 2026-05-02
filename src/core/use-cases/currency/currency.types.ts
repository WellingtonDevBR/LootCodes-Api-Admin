export interface SyncCurrencyDto { admin_id?: string }
export interface SyncCurrencyResult { success: boolean; rates_updated: number }

export interface UpdateCurrencyManualDto { currency_code: string; rate: number; admin_id: string }
export interface UpdateCurrencyManualResult { success: boolean }

export interface GetCurrencyRatesResult { rates: Array<{ code: string; rate: number; updated_at: string }> }
