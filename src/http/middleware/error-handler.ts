import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, RateLimitError, ServiceUnavailableError } from '../../core/errors/domain-errors.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('error-handler');

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const requestId = (request as unknown as Record<string, unknown>).requestId as string | undefined;

  if (error.validation) {
    return reply.code(400).send({
      error: error.message,
      code: 'VALIDATION_ERROR',
    });
  }

  if (error instanceof RateLimitError) {
    const headers: Record<string, string> = {};
    if (error.retryAfterMinutes) {
      headers['Retry-After'] = String(error.retryAfterMinutes * 60);
    }
    return reply.code(429).headers(headers).send({
      error: error.message,
      code: error.code,
    });
  }

  if (error instanceof ServiceUnavailableError) {
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds) {
      headers['Retry-After'] = String(error.retryAfterSeconds);
    }
    return reply.code(503).headers(headers).send({
      error: error.message,
      code: error.code,
    });
  }

  if (error instanceof DomainError) {
    return reply.code(error.statusCode).send({
      error: error.message,
      code: error.code,
    });
  }

  logger.error('Unhandled error', error, { requestId });

  return reply.code(500).send({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}
