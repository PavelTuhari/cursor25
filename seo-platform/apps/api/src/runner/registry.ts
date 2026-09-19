import { defaultRegistry, type ToolRegistry } from './tools.js';
import { createSerpTool } from './connectors/serp.js';
import { GoogleOAuthTokenProvider, createGscTool } from './connectors/gsc.js';

/**
 * Сборка набора инструментов из конфигурации.
 *
 * Коннектор без ключа не регистрируется — и плейбук, которому он нужен, будет
 * отклонён с понятной причиной. Это намеренно: «подключить наполовину» в SEO
 * означает получить выдуманные позиции вместо реальных.
 */

export interface RegistryConfig {
  serp?: { apiKey: string; endpoint?: string };
  gsc?: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    siteUrl: string;
  };
}

export function buildRegistry(config: RegistryConfig): ToolRegistry {
  const registry = defaultRegistry();
  if (config.serp?.apiKey) {
    registry.register(createSerpTool(config.serp));
  }
  if (config.gsc?.refreshToken && config.gsc.siteUrl) {
    registry.register(
      createGscTool({
        siteUrl: config.gsc.siteUrl,
        tokenProvider: new GoogleOAuthTokenProvider({
          clientId: config.gsc.clientId,
          clientSecret: config.gsc.clientSecret,
          refreshToken: config.gsc.refreshToken,
        }),
      }),
    );
  }
  return registry;
}

/** Конфигурация коннекторов из переменных окружения. */
export function registryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RegistryConfig {
  const config: RegistryConfig = {};
  if (env['SERP_API_KEY']) {
    config.serp = { apiKey: env['SERP_API_KEY'] };
    if (env['SERP_ENDPOINT']) config.serp.endpoint = env['SERP_ENDPOINT'];
  }
  if (env['GSC_REFRESH_TOKEN'] && env['GSC_SITE_URL']) {
    config.gsc = {
      clientId: env['GSC_CLIENT_ID'] ?? '',
      clientSecret: env['GSC_CLIENT_SECRET'] ?? '',
      refreshToken: env['GSC_REFRESH_TOKEN'],
      siteUrl: env['GSC_SITE_URL'],
    };
  }
  return config;
}
