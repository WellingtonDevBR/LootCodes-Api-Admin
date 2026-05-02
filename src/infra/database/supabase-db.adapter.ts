import { injectable } from 'tsyringe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { IDatabase, QueryOptions } from '../../core/ports/database.port.js';
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

  async query<T = unknown>(table: string, options?: QueryOptions): Promise<T[]> {
    let q = this.getClient().from(table).select(options?.select ?? '*');
    if (options?.eq) for (const [col, val] of options.eq) q = q.eq(col, val as string);
    if (options?.neq) for (const [col, val] of options.neq) q = q.neq(col, val as string);
    if (options?.in) for (const [col, vals] of options.in) q = q.in(col, vals as string[]);
    if (options?.order) q = q.order(options.order.column, { ascending: options.order.ascending ?? true });
    if (options?.limit) q = q.limit(options.limit);
    const { data, error } = await q;
    if (error) throw new InternalError(`Query failed on ${table}: ${error.message}`);
    return (data ?? []) as T[];
  }

  async queryOne<T = unknown>(table: string, options?: QueryOptions): Promise<T | null> {
    let q = this.getClient().from(table).select(options?.select ?? '*');
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
}
