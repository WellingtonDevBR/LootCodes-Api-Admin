import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard } from '../middleware/auth.guard.js';
import type { ListSettingsUseCase } from '../../core/use-cases/settings/list-settings.use-case.js';
import type { UpdateSettingUseCase } from '../../core/use-cases/settings/update-setting.use-case.js';
import type { GetPlatformSettingsUseCase } from '../../core/use-cases/settings/get-platform-settings.use-case.js';
import type { ListLanguagesUseCase } from '../../core/use-cases/settings/list-languages.use-case.js';
import type { CreateLanguageUseCase } from '../../core/use-cases/settings/create-language.use-case.js';
import type { UpdateLanguageUseCase } from '../../core/use-cases/settings/update-language.use-case.js';
import type { ListCountriesUseCase } from '../../core/use-cases/settings/list-countries.use-case.js';
import type { CreateCountryUseCase } from '../../core/use-cases/settings/create-country.use-case.js';
import type { UpdateCountryUseCase } from '../../core/use-cases/settings/update-country.use-case.js';
import type { ListRegionsUseCase } from '../../core/use-cases/settings/list-regions.use-case.js';
import type { CreateRegionUseCase } from '../../core/use-cases/settings/create-region.use-case.js';
import type { UpdateRegionUseCase } from '../../core/use-cases/settings/update-region.use-case.js';
import type { GetRegionExcludedCountriesUseCase } from '../../core/use-cases/settings/get-region-excluded-countries.use-case.js';
import type { ListPlatformFamiliesUseCase } from '../../core/use-cases/settings/list-platform-families.use-case.js';
import type { CreatePlatformFamilyUseCase } from '../../core/use-cases/settings/create-platform-family.use-case.js';
import type { UpdatePlatformFamilyUseCase } from '../../core/use-cases/settings/update-platform-family.use-case.js';
import type { DeletePlatformFamilyUseCase } from '../../core/use-cases/settings/delete-platform-family.use-case.js';
import type { ListPlatformsUseCase } from '../../core/use-cases/settings/list-platforms.use-case.js';
import type { CreatePlatformUseCase } from '../../core/use-cases/settings/create-platform.use-case.js';
import type { UpdatePlatformUseCase } from '../../core/use-cases/settings/update-platform.use-case.js';
import type { ListGenresUseCase } from '../../core/use-cases/settings/list-genres.use-case.js';
import type { CreateGenreUseCase } from '../../core/use-cases/settings/create-genre.use-case.js';
import type { UpdateGenreUseCase } from '../../core/use-cases/settings/update-genre.use-case.js';
import type { DeleteGenreUseCase } from '../../core/use-cases/settings/delete-genre.use-case.js';

interface IdParams { id: string }

export async function adminSettingsRoutes(app: FastifyInstance) {

  // ── Platform settings (JSONB key-value) ─────────────────────────

  app.get('/platform-settings', { preHandler: [adminGuard] }, async (_request, reply) => {
    const uc = container.resolve<GetPlatformSettingsUseCase>(UC_TOKENS.GetPlatformSettings);
    const result = await uc.execute();
    return reply.send(result);
  });

  app.put<{ Params: { key: string }; Body: { value: unknown } }>(
    '/platform-settings/:key',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const uc = container.resolve<UpdateSettingUseCase>(UC_TOKENS.UpdateSetting);
      const authUser = (request as unknown as Record<string, unknown>).authUser as { id: string };
      const result = await uc.execute({
        key: request.params.key,
        value: request.body.value,
        admin_id: authUser.id,
      });
      return reply.send(result);
    },
  );

  app.get('/list', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<ListSettingsUseCase>(UC_TOKENS.ListSettings);
    const query = request.query as { category?: string };
    const result = await uc.execute({ category: query.category });
    return reply.send(result);
  });

  // ── Languages ───────────────────────────────────────────────────

  app.get('/languages', { preHandler: [adminGuard] }, async (_request, reply) => {
    const uc = container.resolve<ListLanguagesUseCase>(UC_TOKENS.ListLanguages);
    return reply.send(await uc.execute());
  });

  app.post<{ Body: { name: string; code: string; native_name?: string } }>(
    '/languages',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { name, code, native_name } = request.body;
      if (!name || !code) return reply.code(400).send({ error: 'name and code are required' });
      const uc = container.resolve<CreateLanguageUseCase>(UC_TOKENS.CreateLanguage);
      return reply.code(201).send(await uc.execute({ name, code, native_name }));
    },
  );

  app.put<{ Params: IdParams; Body: { name?: string; code?: string; native_name?: string; is_active?: boolean } }>(
    '/languages/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const uc = container.resolve<UpdateLanguageUseCase>(UC_TOKENS.UpdateLanguage);
      return reply.send(await uc.execute(request.params.id, request.body));
    },
  );

  // ── Countries ───────────────────────────────────────────────────

  app.get('/countries', { preHandler: [adminGuard] }, async (_request, reply) => {
    const uc = container.resolve<ListCountriesUseCase>(UC_TOKENS.ListCountries);
    return reply.send(await uc.execute());
  });

  app.post<{ Body: { name: string; code: string } }>(
    '/countries',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { name, code } = request.body;
      if (!name || !code) return reply.code(400).send({ error: 'name and code are required' });
      const uc = container.resolve<CreateCountryUseCase>(UC_TOKENS.CreateCountry);
      return reply.code(201).send(await uc.execute({ name, code }));
    },
  );

  app.put<{ Params: IdParams; Body: { name?: string; code?: string; is_active?: boolean } }>(
    '/countries/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const uc = container.resolve<UpdateCountryUseCase>(UC_TOKENS.UpdateCountry);
      return reply.send(await uc.execute(request.params.id, request.body));
    },
  );

  // ── Regions ─────────────────────────────────────────────────────

  app.get('/regions', { preHandler: [adminGuard] }, async (_request, reply) => {
    const uc = container.resolve<ListRegionsUseCase>(UC_TOKENS.ListRegions);
    return reply.send(await uc.execute());
  });

  app.post<{ Body: { name: string; code: string; is_global?: boolean; restrictions?: string } }>(
    '/regions',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { name, code } = request.body;
      if (!name || !code) return reply.code(400).send({ error: 'name and code are required' });
      const uc = container.resolve<CreateRegionUseCase>(UC_TOKENS.CreateRegion);
      return reply.code(201).send(await uc.execute(request.body));
    },
  );

  app.put<{ Params: IdParams; Body: { name?: string; code?: string; is_global?: boolean; restrictions?: string; excluded_country_ids?: string[] } }>(
    '/regions/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const uc = container.resolve<UpdateRegionUseCase>(UC_TOKENS.UpdateRegion);
      return reply.send(await uc.execute(request.params.id, request.body));
    },
  );

  app.get<{ Params: IdParams }>(
    '/regions/:id/excluded-countries',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const uc = container.resolve<GetRegionExcludedCountriesUseCase>(UC_TOKENS.GetRegionExcludedCountries);
      return reply.send(await uc.execute(request.params.id));
    },
  );

  // ── Platform families ───────────────────────────────────────────

  app.get('/platform-families', { preHandler: [adminGuard] }, async (_request, reply) => {
    const uc = container.resolve<ListPlatformFamiliesUseCase>(UC_TOKENS.ListPlatformFamilies);
    return reply.send(await uc.execute());
  });

  app.post<{ Body: { name: string; code: string; slug: string } }>(
    '/platform-families',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { name, code, slug } = request.body;
      if (!name || !code || !slug) return reply.code(400).send({ error: 'name, code, and slug are required' });
      const uc = container.resolve<CreatePlatformFamilyUseCase>(UC_TOKENS.CreatePlatformFamily);
      return reply.code(201).send(await uc.execute({ name, code, slug }));
    },
  );

  app.put<{ Params: IdParams; Body: { name?: string; code?: string; slug?: string; icon_url?: string | null } }>(
    '/platform-families/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const uc = container.resolve<UpdatePlatformFamilyUseCase>(UC_TOKENS.UpdatePlatformFamily);
      return reply.send(await uc.execute(request.params.id, request.body));
    },
  );

  app.delete<{ Params: IdParams }>(
    '/platform-families/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const uc = container.resolve<DeletePlatformFamilyUseCase>(UC_TOKENS.DeletePlatformFamily);
      await uc.execute(request.params.id);
      return reply.code(204).send();
    },
  );

  // ── Platforms ───────────────────────────────────────────────────

  app.get('/platforms', { preHandler: [adminGuard] }, async (_request, reply) => {
    const uc = container.resolve<ListPlatformsUseCase>(UC_TOKENS.ListPlatforms);
    return reply.send(await uc.execute());
  });

  app.post<{ Body: { name: string; code: string; slug: string; icon_url?: string | null; default_instructions?: string | null; redemption_url_template?: string | null; key_display_label?: string | null } }>(
    '/platforms',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { name, code, slug } = request.body;
      if (!name || !code || !slug) return reply.code(400).send({ error: 'name, code, and slug are required' });
      const uc = container.resolve<CreatePlatformUseCase>(UC_TOKENS.CreatePlatform);
      return reply.code(201).send(await uc.execute(request.body));
    },
  );

  app.put<{ Params: IdParams; Body: { name?: string; code?: string; icon_url?: string | null; default_instructions?: string | null; family_id?: string | null; redemption_url_template?: string | null; key_display_label?: string | null } }>(
    '/platforms/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const uc = container.resolve<UpdatePlatformUseCase>(UC_TOKENS.UpdatePlatform);
      return reply.send(await uc.execute(request.params.id, request.body));
    },
  );

  // ── Genres ──────────────────────────────────────────────────────

  app.get('/genres', { preHandler: [adminGuard] }, async (_request, reply) => {
    const uc = container.resolve<ListGenresUseCase>(UC_TOKENS.ListGenres);
    return reply.send(await uc.execute());
  });

  app.post<{ Body: { name: string; slug?: string } }>(
    '/genres',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const { name } = request.body;
      if (!name) return reply.code(400).send({ error: 'name is required' });
      const uc = container.resolve<CreateGenreUseCase>(UC_TOKENS.CreateGenre);
      return reply.code(201).send(await uc.execute(request.body));
    },
  );

  app.put<{ Params: IdParams; Body: { name?: string; slug?: string; sort_order?: number } }>(
    '/genres/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const uc = container.resolve<UpdateGenreUseCase>(UC_TOKENS.UpdateGenre);
      return reply.send(await uc.execute(request.params.id, request.body));
    },
  );

  app.delete<{ Params: IdParams }>(
    '/genres/:id',
    { preHandler: [adminGuard] },
    async (request, reply) => {
      const uc = container.resolve<DeleteGenreUseCase>(UC_TOKENS.DeleteGenre);
      await uc.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
