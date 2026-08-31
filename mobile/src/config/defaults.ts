/**
 * The configuration bundled with the binary. It is the fallback whenever the
 * backend is unreachable and the source of truth for the very first launch.
 */
import appConfigJson from '@config/app.config.json';
import themeConfigJson from '@config/theme.config.json';
import navigationConfigJson from '@config/navigation.config.json';
import entitiesConfigJson from '@config/entities.config.json';
import homeScreen from '@config/screens/home.json';
import catalogScreen from '@config/screens/catalog.json';
import promosScreen from '@config/screens/promos.json';
import listScreen from '@config/screens/list.json';
import loyaltyScreen from '@config/screens/loyalty.json';
import storesScreen from '@config/screens/stores.json';
import profileScreen from '@config/screens/profile.json';
import ro from '@config/l10n/ro.json';
import ru from '@config/l10n/ru.json';
import en from '@config/l10n/en.json';

import type {
  AppConfig,
  ConfigBundle,
  EntitiesConfig,
  NavigationConfig,
  ScreenConfig,
  ThemeConfig,
  Translations,
} from './types';

const screens: Record<string, ScreenConfig> = {};
for (const screen of [
  homeScreen,
  catalogScreen,
  promosScreen,
  listScreen,
  loyaltyScreen,
  storesScreen,
  profileScreen,
] as unknown as ScreenConfig[]) {
  screens[screen.id] = screen;
}

export const bundledConfig: ConfigBundle = {
  app: appConfigJson as unknown as AppConfig,
  theme: themeConfigJson as unknown as ThemeConfig,
  navigation: navigationConfigJson as unknown as NavigationConfig,
  entities: entitiesConfigJson as unknown as EntitiesConfig,
  screens,
  translations: {
    ro: ro as unknown as Translations,
    ru: ru as unknown as Translations,
    en: en as unknown as Translations,
  },
};
