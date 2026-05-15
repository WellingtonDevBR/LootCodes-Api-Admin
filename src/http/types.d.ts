/**
 * Fastify request augmentation for our auth guards.
 *
 * `adminGuard`, `employeeGuard`, and `internalSecretGuard` attach the
 * authenticated user to the request as `authUser`. Adding the field to the
 * type system means consumers can read `request.authUser` directly instead
 * of the brittle `(request as unknown as Record<string, unknown>).authUser`
 * cast that proliferated across the routes.
 */
import 'fastify';

declare module 'fastify' {
  interface AuthUser {
    /** Supabase `auth.users.id` (or `'internal'`/`'cron-...'` for service callers). */
    id: string;
    /** Optional email (only available for human users). */
    email?: string;
    /**
     * Optional role label. Common values: `'admin'`, `'employee'`, `'service'`.
     * Typed as a string (not a literal union) because the auth provider's user
     * payload is forwarded verbatim.
     */
    role?: string;
  }

  interface FastifyRequest {
    /** Populated by every auth guard. Undefined on public/unauthenticated requests. */
    authUser?: AuthUser;
    /**
     * Request-correlation id propagated through `X-Request-Id`. Set by the
     * `onRequest` hook in `app.ts`. Fastify's built-in `request.id` is also
     * available, but legacy code expects this field.
     */
    requestId?: string;
  }
}

export {};
