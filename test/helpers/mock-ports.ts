import type { IDatabase, QueryOptions, PaginatedResult } from '../../src/core/ports/database.port.js';
import type { IAuthProvider, AuthUser } from '../../src/core/ports/auth.port.js';
import type { IAdminRoleChecker } from '../../src/core/ports/admin-role.port.js';
import type { IIpBlocklist } from '../../src/core/ports/ip-blocklist.port.js';

export class MockDatabase implements IDatabase {
  private rpcResults: Map<string, unknown> = new Map();
  private queryResults: Map<string, unknown[]> = new Map();

  setRpcResult(name: string, result: unknown) {
    this.rpcResults.set(name, result);
  }

  setQueryResult(table: string, result: unknown[]) {
    this.queryResults.set(table, result);
  }

  async query<T = unknown>(table: string, _options?: QueryOptions): Promise<T[]> {
    return (this.queryResults.get(table) ?? []) as T[];
  }

  async queryOne<T = unknown>(table: string, _options?: QueryOptions): Promise<T | null> {
    const results = this.queryResults.get(table) ?? [];
    return (results[0] ?? null) as T | null;
  }

  async queryPaginated<T = unknown>(table: string, _options?: QueryOptions): Promise<PaginatedResult<T>> {
    const data = (this.queryResults.get(table) ?? []) as T[];
    return { data, total: data.length };
  }

  async insert<T = unknown>(_table: string, data: Record<string, unknown>): Promise<T> {
    return { id: 'mock-id', ...data } as T;
  }

  async update<T = unknown>(_table: string, _filter: Record<string, unknown>, data: Record<string, unknown>): Promise<T[]> {
    return [data] as T[];
  }

  async upsert<T = unknown>(_table: string, data: Record<string, unknown>, _onConflict?: string): Promise<T> {
    return data as T;
  }

  async delete(_table: string, _filter: Record<string, unknown>): Promise<number> {
    return 1;
  }

  async rpc<T = unknown>(functionName: string, _params?: Record<string, unknown>): Promise<T> {
    if (this.rpcResults.has(functionName)) {
      return this.rpcResults.get(functionName) as T;
    }
    return {} as T;
  }
}

export class MockAuthProvider implements IAuthProvider {
  private users: Map<string, AuthUser> = new Map();

  setUser(token: string, user: AuthUser) {
    this.users.set(token, user);
  }

  async getUserByToken(token: string): Promise<AuthUser | null> {
    return this.users.get(token) ?? null;
  }
}

export class MockAdminRoleChecker implements IAdminRoleChecker {
  private adminUsers: Set<string> = new Set();
  private employeeUsers: Set<string> = new Set();

  setAdmin(userId: string) {
    this.adminUsers.add(userId);
    this.employeeUsers.add(userId);
  }

  setEmployee(userId: string) {
    this.employeeUsers.add(userId);
  }

  async isAdminOrEmployee(userId: string): Promise<boolean> {
    return this.employeeUsers.has(userId);
  }

  async isAdmin(userId: string): Promise<boolean> {
    return this.adminUsers.has(userId);
  }
}

export class MockIpBlocklist implements IIpBlocklist {
  private blocked: Set<string> = new Set();

  addBlocked(ip: string) {
    this.blocked.add(ip);
  }

  async isBlocked(ipAddress: string): Promise<boolean> {
    return this.blocked.has(ipAddress);
  }
}

export interface MockPorts {
  db: MockDatabase;
  auth: MockAuthProvider;
  roleChecker: MockAdminRoleChecker;
  ipBlocklist: MockIpBlocklist;
}

export function createMockPorts(): MockPorts {
  return {
    db: new MockDatabase(),
    auth: new MockAuthProvider(),
    roleChecker: new MockAdminRoleChecker(),
    ipBlocklist: new MockIpBlocklist(),
  };
}
