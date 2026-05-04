import { injectable } from 'tsyringe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { IStorage } from '../../core/ports/storage.port.js';
import { getEnv } from '../../config/env.js';

@injectable()
export class SupabaseStorageAdapter implements IStorage {
  private client: SupabaseClient | null = null;

  private getClient(): SupabaseClient {
    if (this.client) return this.client;
    const env = getEnv();
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    return this.client;
  }

  async createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string | null> {
    const { data, error } = await this.getClient()
      .storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }
}
