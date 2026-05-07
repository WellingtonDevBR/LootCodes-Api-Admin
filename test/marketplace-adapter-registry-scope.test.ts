import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import { describe, expect, it } from 'vitest';
import { TOKENS } from '../src/di/tokens.js';
import { MarketplaceAdapterRegistry } from '../src/infra/marketplace/marketplace-adapter-registry.js';

describe('MarketplaceAdapterRegistry DI scope', () => {
  it('resolves to the same instance when registered as Singleton (bootstrap shares state with repositories)', () => {
    const c = rootContainer.createChildContainer();
    c.registerSingleton(TOKENS.MarketplaceAdapterRegistry, MarketplaceAdapterRegistry);

    const a = c.resolve(TOKENS.MarketplaceAdapterRegistry);
    const b = c.resolve(TOKENS.MarketplaceAdapterRegistry);
    expect(a).toBe(b);
  });

  it('uses distinct instances under tsyringe default Transient registration (regression guard)', () => {
    const c = rootContainer.createChildContainer();
    c.register(TOKENS.MarketplaceAdapterRegistry, { useClass: MarketplaceAdapterRegistry });

    expect(c.resolve(TOKENS.MarketplaceAdapterRegistry)).not.toBe(
      c.resolve(TOKENS.MarketplaceAdapterRegistry),
    );
  });
});
