export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  role?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface IAuthProvider {
  getUserByToken(token: string): Promise<AuthUser | null>;
}
