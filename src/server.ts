import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import './di/container.js';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const SHUTDOWN_TIMEOUT_MS = 2000;

async function main() {
  const env = loadEnv();
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully…`);
    try {
      await app.close();
    } catch {
      // Fastify close can throw if server not fully started
    }
    await Sentry.close(SHUTDOWN_TIMEOUT_MS);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    Sentry.captureException(err);
    app.log.error(err);
    await Sentry.close(SHUTDOWN_TIMEOUT_MS);
    process.exit(1);
  }
}

main();
