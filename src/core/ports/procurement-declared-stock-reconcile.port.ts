export interface ProcurementDeclaredStockReconcileDto {
  readonly variant_ids?: readonly string[] | undefined;
  readonly dry_run?: boolean | undefined;
  /** Hard cap on listings processed in one request (default 500). */
  readonly batch_limit?: number | undefined;
}

export interface ProcurementDeclaredStockReconcileFailure {
  readonly listing_id: string;
  readonly reason: string;
}

export interface ProcurementDeclaredStockReconcileResult {
  /** When true, no marketplace APIs were called; `updated` is a simulation count only. */
  readonly dry_run: boolean;
  readonly scanned: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failures: readonly ProcurementDeclaredStockReconcileFailure[];
}

export interface IProcurementDeclaredStockReconcileService {
  execute(
    requestId: string,
    dto: ProcurementDeclaredStockReconcileDto,
  ): Promise<ProcurementDeclaredStockReconcileResult>;
}
