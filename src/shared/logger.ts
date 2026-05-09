import * as Sentry from '@sentry/node';
import { AsyncLocalStorage } from 'node:async_hooks';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  userId?: string;
  orderId?: string;
  action?: string;
  duration?: number;
  [key: string]: unknown;
}

interface RequestContext {
  requestId: string;
}

/**
 * AsyncLocalStorage store for the current request's context.
 * Set via requestContextStore.run({ requestId }, done) in the onRequest hook
 * so every log line emitted within a request automatically includes requestId.
 */
export const requestContextStore = new AsyncLocalStorage<RequestContext>();

class Logger {
  constructor(private name: string) {}

  private formatJson(level: LogLevel, message: string, context?: LogContext): string {
    const store = requestContextStore.getStore();
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      logger: this.name,
      msg: message,
    };
    if (store?.requestId) entry['requestId'] = store.requestId;
    if (context) Object.assign(entry, context);
    return JSON.stringify(entry);
  }

  debug(message: string, context?: LogContext) {
    // eslint-disable-next-line no-console
    console.debug(this.formatJson('debug', message, context));
  }

  info(message: string, context?: LogContext) {
    // eslint-disable-next-line no-console
    console.info(this.formatJson('info', message, context));
  }

  warn(message: string, context?: LogContext): void;
  warn(message: string, error: Error | unknown, context?: LogContext): void;
  warn(message: string, second?: Error | unknown | LogContext, third?: LogContext) {
    const details = this.mergeErrorContext(second, third);
    // eslint-disable-next-line no-console
    console.warn(this.formatJson('warn', message, details));
    this.forwardToSentry('warning', message, second, third, details);
  }

  error(message: string, context?: LogContext): void;
  error(message: string, error: Error | unknown, context?: LogContext): void;
  error(message: string, second?: Error | unknown | LogContext, third?: LogContext) {
    const details = this.mergeErrorContext(second, third);
    // eslint-disable-next-line no-console
    console.error(this.formatJson('error', message, details));
    this.forwardToSentry('error', message, second, third, details);
  }

  private forwardToSentry(
    level: 'warning' | 'error',
    message: string,
    second: Error | unknown | LogContext | undefined,
    third: LogContext | undefined,
    details: LogContext | undefined,
  ): void {
    const err = third !== undefined ? second : second instanceof Error ? second : null;
    if (err instanceof Error) {
      Sentry.captureException(err, {
        level,
        extra: { logger: this.name, message, ...details },
      });
    } else {
      Sentry.captureMessage(`[${this.name}] ${message}`, {
        level,
        extra: { logger: this.name, ...details },
      });
    }
  }

  /**
   * Starts a timed operation log. Call the returned function when the operation
   * completes (or fails) to emit the duration. Use in a try/finally to guarantee
   * the end log always fires:
   *
   *   const end = logger.startOperation('do-thing', ctx);
   *   try { await doThing(); end(); }
   *   catch (err) { end(); throw err; }
   */
  startOperation(operationName: string, context?: LogContext): () => void {
    const startTime = Date.now();
    this.info(`Starting: ${operationName}`, context);
    return () => {
      this.info(`Completed: ${operationName}`, { ...context, duration: Date.now() - startTime });
    };
  }

  private mergeErrorContext(
    second?: Error | unknown | LogContext,
    third?: LogContext,
  ): LogContext | undefined {
    if (third !== undefined) {
      const err = second;
      return err != null
        ? {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            ...third,
          }
        : third;
    }
    if (second instanceof Error || (second != null && typeof second !== 'object')) {
      const err = second;
      return err != null
        ? {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          }
        : undefined;
    }
    return second as LogContext | undefined;
  }
}

export function createLogger(name: string): Logger {
  return new Logger(name);
}
