import { injectable } from 'tsyringe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { IAuthProvider, AuthUser } from '../../core/ports/auth.port.js';
import { getEnv } from '../../config/env.js';

@injectable()
export class SupabaseAuthAdapter implements IAuthProvider {
  private client: SupabaseClient | null = null;

  private getClient(): SupabaseClient {
    if (this.client) return this.client;
    const env = getEnv();
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: {
        headers: { apikey: env.SUPABASE_ANON_KEY },
      },
    });
    return this.client;
  }

  async getUserByToken(token: string): Promise<AuthUser | null> {
    const { data: { user }, error } = await this.getClient().auth.getUser(token);
    if (error || !user) return null;
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      user_metadata: user.user_metadata,
      app_metadata: user.app_metadata,
      created_at: user.created_at,
    };
  }
}
