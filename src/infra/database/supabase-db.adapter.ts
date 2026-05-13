import { injectable } from 'tsyringe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { IDatabase, PaginatedResult, QueryOptions } from '../../core/ports/database.port.js';
import { InternalError } from '../../core/errors/domain-errors.js';
import { getEnv } from '../../config/env.js';

@injectable()
export class SupabaseDbAdapter implements IDatabase {
  private client: SupabaseClient | null = null;

  private getClient(): SupabaseClient {
    if (this.client) return this.client;
    const env = getEnv();
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    return this.client;
  }

  private applyFilters(q: unknown, options?: QueryOptions): unknown {
    let query = q as ReturnType<ReturnType<SupabaseClient['from']>['select']>;
    if (options?.filter) for (const [col, val] of Object.entries(options.filter)) query = query.eq(col, val as string);
    if (options?.eq) for (const [col, val] of options.eq) query = query.eq(col, val as string);
    if (options?.neq) for (const [col, val] of options.neq) query = query.neq(col, val as string);
    if (options?.in) for (const [col, vals] of options.in) query = query.in(col, vals as string[]);
    if (options?.or) query = query.or(options.or);
    if (options?.ilike) for (const [col, pattern] of options.ilike) query = query.ilike(col, pattern);
    if (options?.lt) for (const [col, val] of options.lt) query = query.lt(col, val as string);
    if (options?.gt) for (const [col, val] of options.gt) query = query.gt(col, val as string);
    if (options?.gte) for (const [col, val] of options.gte) query = query.gte(col, val as string);
    if (options?.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? true });
    if (options?.range) query = query.range(options.range[0], options.range[1]);
    else if (options?.limit) query = query.limit(options.limit);
    return query;
  }

  async query<T = unknown>(table: string, options?: QueryOptions): Promise<T[]> {
    const q = this.getClient().from(table).select(options?.select ?? '*');
    const query = this.applyFilters(q, options) as ReturnType<ReturnType<SupabaseClient['from']>['select']>;
    const { data, error } = await query;
    if (error) throw new InternalError(`Query failed on ${table}: ${error.message}`);
    return (data ?? []) as T[];
  }

  async queryAll<T = unknown>(table: string, options?: Omit<QueryOptions, 'range' | 'limit'>): Promise<T[]> {
    const PAGE = 1000;
    const all: T[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.query<T>(table, {
        ...options,
        range: [offset, offset + PAGE - 1],
      } as QueryOptions);
      all.push(...page);
      if (page.length < PAGE) break;
      offset += PAGE;
    }
    return all;
  }

  async queryPaginated<T = unknown>(table: string, options?: QueryOptions): Promise<PaginatedResult<T>> {
    const q = this.getClient().from(table).select(options?.select ?? '*', { count: 'exact' });
    const query = this.applyFilters(q, options) as ReturnType<ReturnType<SupabaseClient['from']>['select']>;
    const { data, error, count } = await query;
    if (error) throw new InternalError(`Query failed on ${table}: ${error.message}`);
    return { data: (data ?? []) as T[], total: count ?? 0 };
  }

  async queryOne<T = unknown>(table: string, options?: QueryOptions): Promise<T | null> {
    let q = this.getClient().from(table).select(options?.select ?? '*');
    if (options?.filter) for (const [col, val] of Object.entries(options.filter)) q = q.eq(col, val as string);
    if (options?.eq) for (const [col, val] of options.eq) q = q.eq(col, val as string);
    if (options?.neq) for (const [col, val] of options.neq) q = q.neq(col, val as string);
    if (options?.in) for (const [col, vals] of options.in) q = q.in(col, vals as string[]);
    const { data, error } = await q.maybeSingle();
    if (error) throw new InternalError(`QueryOne failed on ${table}: ${error.message}`);
    return data as T | null;
  }

  async insert<T = unknown>(table: string, data: Record<string, unknown>): Promise<T> {
    const { data: result, error } = await this.getClient()
      .from(table)
      .insert(data)
      .select('*')
      .single();
    if (error) throw new InternalError(`Insert failed on ${table}: ${error.message}`);
    return result as T;
  }

  async insertMany(table: string, rows: Record<string, unknown>[]): Promise<number> {
    if (rows.length === 0) return 0;
    const { error } = await this.getClient()
      .from(table)
      .insert(rows);
    if (error) throw new InternalError(`Bulk insert failed on ${table}: ${error.message}`);
    return rows.length;
  }

  async update<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<T[]> {
    let query = this.getClient().from(table).update(data);
    for (const [key, value] of Object.entries(filter)) {
      query = query.eq(key, value);
    }
    const { data: result, error } = await query.select('*');
    if (error) throw new InternalError(`Update failed on ${table}: ${error.message}`);
    return (result ?? []) as T[];
  }

  async upsert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    onConflict?: string,
  ): Promise<T> {
    const opts = onConflict ? { onConflict } : {};
    const { data: result, error } = await this.getClient()
      .from(table)
      .upsert(data, opts)
      .select('*')
      .single();
    if (error) throw new InternalError(`Upsert failed on ${table}: ${error.message}`);
    return result as T;
  }

  async upsertMany(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.getClient()
      .from(table)
      .upsert(rows, { onConflict });
    if (error) throw new InternalError(`UpsertMany failed on ${table}: ${error.message}`);
  }

  async delete(table: string, filter: Record<string, unknown>): Promise<number> {
    let query = this.getClient().from(table).delete();
    for (const [key, value] of Object.entries(filter)) {
      query = query.eq(key, value);
    }
    const { error, count } = await query;
    if (error) throw new InternalError(`Delete failed on ${table}: ${error.message}`);
    return count ?? 0;
  }

  async rpc<T = unknown>(functionName: string, params?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.getClient().rpc(functionName, params);
    if (error) throw new InternalError(`RPC ${functionName} failed: ${error.message}`);
    return data as T;
  }

  async invokeFunction<T = unknown>(functionName: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.getClient().functions.invoke(functionName, { body });
    if (error) throw new InternalError(`Edge Function ${functionName} failed: ${error.message}`);
    return data as T;
  }

  async invokeInternalFunction<T = unknown>(functionName: string, body: Record<string, unknown>): Promise<T> {
    const env = getEnv();
    const secret = env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      throw new InternalError(`Missing INTERNAL_SERVICE_SECRET — cannot invoke ${functionName}`);
    }
    const { data, error } = await this.getClient().functions.invoke(functionName, {
      body,
      headers: { 'x-internal-secret': secret },
    });
    if (error) throw new InternalError(`Internal Edge Function ${functionName} failed: ${error.message}`);
    return data as T;
  }
}
