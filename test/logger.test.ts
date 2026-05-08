import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';
import { createLogger } from '../src/shared/logger.js';

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('createLogger', () => {
  const captureException = vi.mocked(Sentry.captureException);
  const captureMessage = vi.mocked(Sentry.captureMessage);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('debug / info', () => {
    it('does not forward debug to Sentry', () => {
      createLogger('test').debug('hello');
      expect(captureException).not.toHaveBeenCalled();
      expect(captureMessage).not.toHaveBeenCalled();
    });

    it('does not forward info to Sentry', () => {
      createLogger('test').info('hello');
      expect(captureException).not.toHaveBeenCalled();
      expect(captureMessage).not.toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('forwards a context-only warn to Sentry as a warning message', () => {
      createLogger('mod').warn('something off', { orderId: 'o-1' });

      expect(captureException).not.toHaveBeenCalled();
      expect(captureMessage).toHaveBeenCalledWith(
        '[mod] something off',
        expect.objectContaining({
          level: 'warning',
          extra: expect.objectContaining({ logger: 'mod', orderId: 'o-1' }),
        }),
      );
    });

    it('forwards a warn with an Error as captureException at warning level', () => {
      const err = new Error('boom');
      createLogger('mod').warn('soft failure', err, { orderId: 'o-2' });

      expect(captureException).toHaveBeenCalledTimes(1);
      const [actualErr, opts] = captureException.mock.calls[0]!;
      expect(actualErr).toBe(err);
      expect(opts).toMatchObject({
        level: 'warning',
        extra: expect.objectContaining({ logger: 'mod', message: 'soft failure', orderId: 'o-2' }),
      });
      expect(captureMessage).not.toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('forwards a context-only error to Sentry as an error message', () => {
      createLogger('mod').error('bad', { variantId: 'v-1' });

      expect(captureException).not.toHaveBeenCalled();
      expect(captureMessage).toHaveBeenCalledWith(
        '[mod] bad',
        expect.objectContaining({
          level: 'error',
          extra: expect.objectContaining({ logger: 'mod', variantId: 'v-1' }),
        }),
      );
    });

    it('forwards an error with an Error as captureException', () => {
      const err = new Error('explosion');
      createLogger('mod').error('crash', err, { variantId: 'v-2' });

      expect(captureException).toHaveBeenCalledTimes(1);
      const [actualErr, opts] = captureException.mock.calls[0]!;
      expect(actualErr).toBe(err);
      expect(opts).toMatchObject({
        extra: expect.objectContaining({ logger: 'mod', message: 'crash', variantId: 'v-2' }),
      });
      expect(captureMessage).not.toHaveBeenCalled();
    });
  });
});
