type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  userId?: string;
  orderId?: string;
  action?: string;
  duration?: number;
  [key: string]: unknown;
}

class Logger {
  constructor(private name: string) {}

  private format(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` | ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${this.name}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  debug(message: string, context?: LogContext) {
    // eslint-disable-next-line no-console
    console.log(this.format('debug', message, context));
  }

  info(message: string, context?: LogContext) {
    // eslint-disable-next-line no-console
    console.log(this.format('info', message, context));
  }

  warn(message: string, context?: LogContext): void;
  warn(message: string, error: Error | unknown, context?: LogContext): void;
  warn(message: string, second?: Error | unknown | LogContext, third?: LogContext) {
    const details = this.mergeErrorContext(second, third);
    // eslint-disable-next-line no-console
    console.warn(this.format('warn', message, details));
  }

  error(message: string, context?: LogContext): void;
  error(message: string, error: Error | unknown, context?: LogContext): void;
  error(message: string, second?: Error | unknown | LogContext, third?: LogContext) {
    const details = this.mergeErrorContext(second, third);
    // eslint-disable-next-line no-console
    console.error(this.format('error', message, details));
  }

  startOperation(operationName: string, context?: LogContext): () => void {
    const startTime = Date.now();
    this.info(`Starting: ${operationName}`, context);
    return () => {
      const duration = Date.now() - startTime;
      this.info(`Completed: ${operationName}`, { ...context, duration });
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
