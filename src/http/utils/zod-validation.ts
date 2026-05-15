/**
 * Lightweight Zod → Fastify reply helper, modelled after the validation
 * pattern in {@link ../routes/internal-cron.routes.ts}.
 *
 * Provides:
 *   - {@link validateBody} — parse `request.body` against a schema; either
 *     returns the typed value or throws {@link InvalidRequestBodyError}.
 *   - {@link replyInvalidRequestBody} — formats a 400 reply that matches the
 *     `{ error: 'invalid_request_body', issues: [{ path, message }] }` shape
 *     already used by the cron routes and the admin CRM.
 *
 * Use these instead of inline `body.x as string` casts so we never silently
 * accept the wrong shape and so error responses share one schema.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodIssue, ZodSchema } from 'zod';

export interface InvalidRequestBodyIssue {
  readonly path: string;
  readonly message: string;
}

export class InvalidRequestBodyError extends Error {
  public readonly issues: readonly InvalidRequestBodyIssue[];
  constructor(issues: readonly InvalidRequestBodyIssue[]) {
    super('Invalid request body');
    this.name = 'InvalidRequestBodyError';
    this.issues = issues;
  }
}

function formatIssues(issues: readonly ZodIssue[]): InvalidRequestBodyIssue[] {
  return issues.map((i) => ({
    path: i.path.length > 0 ? i.path.join('.') : '<root>',
    message: i.message,
  }));
}

export function validateBody<T>(
  request: FastifyRequest,
  schema: ZodSchema<T>,
): T {
  const parsed = schema.safeParse(request.body ?? {});
  if (parsed.success) return parsed.data;
  throw new InvalidRequestBodyError(formatIssues(parsed.error.issues));
}

export function replyInvalidRequestBody(
  reply: FastifyReply,
  issues: readonly InvalidRequestBodyIssue[],
): FastifyReply {
  return reply.code(400).send({ error: 'invalid_request_body', issues });
}

/**
 * Helper for routes that prefer not to throw — returns either the parsed body
 * or a `{ kind: 'error' }` tuple ready for `reply.send`.
 */
export function parseBody<T>(
  schema: ZodSchema<T>,
  body: unknown,
): { kind: 'ok'; data: T } | { kind: 'error'; issues: InvalidRequestBodyIssue[] } {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return { kind: 'ok', data: parsed.data };
  return { kind: 'error', issues: formatIssues(parsed.error.issues) };
}
