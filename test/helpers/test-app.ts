import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '../../src/di/tokens.js';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import {
  createMockPorts,
  type MockPorts,
  MockDatabase,
  MockAuthProvider,
  MockAdminRoleChecker,
  MockIpBlocklist,
} from './mock-ports.js';
import type { FastifyInstance } from 'fastify';

export interface TestApp {
  app: FastifyInstance;
  mocks: MockPorts;
}

function setMinimalEnv() {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
  process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'test-internal-secret';
  process.env.NODE_ENV = 'test';
}

export async function buildTestApp(): Promise<TestApp> {
  setMinimalEnv();
  loadEnv();

  const mocks = createMockPorts();

  container.register(TOKENS.Database, { useValue: mocks.db as unknown as InstanceType<typeof MockDatabase> });
  container.register(TOKENS.AuthProvider, { useValue: mocks.auth as unknown as InstanceType<typeof MockAuthProvider> });
  container.register(TOKENS.AdminRoleChecker, { useValue: mocks.roleChecker as unknown as InstanceType<typeof MockAdminRoleChecker> });
  container.register(TOKENS.IpBlocklist, { useValue: mocks.ipBlocklist as unknown as InstanceType<typeof MockIpBlocklist> });

  const app = await buildApp();
  await app.ready();

  return { app, mocks };
}

export function createAdminToken(mocks: MockPorts, userId = 'admin-user-1'): string {
  const token = `test-admin-token-${userId}`;
  mocks.auth.setUser(token, {
    id: userId,
    email: 'admin@lootcodes.com',
    role: 'authenticated',
  });
  mocks.roleChecker.setAdmin(userId);
  return token;
}

export function createEmployeeToken(mocks: MockPorts, userId = 'employee-user-1'): string {
  const token = `test-employee-token-${userId}`;
  mocks.auth.setUser(token, {
    id: userId,
    email: 'employee@lootcodes.com',
    role: 'authenticated',
  });
  mocks.roleChecker.setEmployee(userId);
  return token;
}
