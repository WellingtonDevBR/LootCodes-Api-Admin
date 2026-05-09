import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const sentryEnv = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
const dsn = process.env.SENTRY_DSN;

const SENSITIVE_PARAMS = new Set([
  'token', 'access_token', 'email', 'key', 'session', 'jti', 'code',
  'password', 'secret', 'api_key', 'refresh_token',
]);

function scrubSensitiveParams(u?: string): string | undefined {
  if (!u) return u;
  try {
    const url = new URL(u, 'https://placeholder.invalid');
    let changed = false;
    for (const p of SENSITIVE_PARAMS) {
      if (url.searchParams.has(p)) {
        url.searchParams.set(p, '[Filtered]');
        changed = true;
      }
    }
    if (!changed) return u;
    return url.toString().replace('https://placeholder.invalid', '');
  } catch {
    return u;
  }
}

Sentry.init({
  dsn,
  environment: sentryEnv,
  release: process.env.SENTRY_RELEASE,

  enabled: !!dsn,

  tracesSampleRate: sentryEnv === 'development' ? 1.0 : 0.1,
  profilesSampleRate: sentryEnv === 'development' ? 1.0 : 0.1,

  sendDefaultPii: false,
  includeLocalVariables: true,
  enableLogs: true,

  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
    Sentry.nodeRuntimeMetricsIntegration(),
    nodeProfilingIntegration(),
  ],

  beforeSend(event) {
    if (event.request) {
      delete event.request.cookies;
      event.request.url = scrubSensitiveParams(event.request.url);
      delete event.request.query_string;
      if (event.request.headers) {
        delete event.request.headers['Authorization'];
        delete event.request.headers['authorization'];
        delete event.request.headers['Cookie'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-internal-secret'];
      }
    }
    if (event.transaction) {
      event.transaction = event.transaction.replace(/\?.*$/, '');
    }
    if (event.user) {
      delete event.user.ip_address;
      delete event.user.email;
    }
    return event;
  },

  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.data) {
      if (breadcrumb.data.url) breadcrumb.data.url = scrubSensitiveParams(breadcrumb.data.url);
      if (breadcrumb.data['http.url']) breadcrumb.data['http.url'] = scrubSensitiveParams(breadcrumb.data['http.url']);
    }
    return breadcrumb;
  },
});
