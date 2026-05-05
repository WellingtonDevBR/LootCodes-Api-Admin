export interface QueryOptions {
  select?: string;
  filter?: Record<string, unknown>;
  eq?: Array<[string, unknown]>;
  neq?: Array<[string, unknown]>;
  in?: Array<[string, unknown[]]>;
  ilike?: Array<[string, string]>;
  lt?: Array<[string, unknown]>;
  gt?: Array<[string, unknown]>;
  gte?: Array<[string, unknown]>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  range?: [number, number];
  single?: boolean;
  maybeSingle?: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
}

export interface IDatabase {
  query<T = unknown>(table: string, options?: QueryOptions): Promise<T[]>;
  queryOne<T = unknown>(table: string, options?: QueryOptions): Promise<T | null>;
  queryPaginated<T = unknown>(table: string, options?: QueryOptions): Promise<PaginatedResult<T>>;
  insert<T = unknown>(table: string, data: Record<string, unknown>): Promise<T>;
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<number>;
  update<T = unknown>(table: string, filter: Record<string, unknown>, data: Record<string, unknown>): Promise<T[]>;
  upsert<T = unknown>(table: string, data: Record<string, unknown>, onConflict?: string): Promise<T>;
  delete(table: string, filter: Record<string, unknown>): Promise<number>;
  rpc<T = unknown>(functionName: string, params?: Record<string, unknown>): Promise<T>;
  invokeFunction<T = unknown>(functionName: string, body: Record<string, unknown>): Promise<T>;
}
