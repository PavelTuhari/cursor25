/**
 * The bundled configuration must match what is on disk.
 *
 * This gap is invisible to everything else: `validate-config` reads the files
 * directly, and TypeScript is happy either way. A screen added to
 * `config/screens/` but not to `defaults.ts` compiles, validates, and then shows
 * "not configured" on a device that has never reached the backend.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bundledConfig } from '../src/config/defaults';

const configDir = join(__dirname, '..', 'config');

function screenFiles(): string[] {
  return readdirSync(join(configDir, 'screens'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''));
}

describe('bundled configuration', () => {
  it('bundles every screen that exists on disk', () => {
    const onDisk = screenFiles().sort();
    const bundled = Object.keys(bundledConfig.screens).sort();
    expect(bundled).toEqual(onDisk);
  });

  it('bundles a screen for every tab', () => {
    for (const tab of bundledConfig.navigation.tabs) {
      expect(bundledConfig.screens[tab.screen]).toBeDefined();
    }
  });

  it('bundles every screen a menu item navigates to', () => {
    const targets = new Set<string>();
    for (const screen of Object.values(bundledConfig.screens)) {
      for (const block of screen.blocks) {
        const items = (block.props?.['items'] ?? []) as Array<Record<string, any>>;
        for (const item of Array.isArray(items) ? items : []) {
          if (item['action']?.type === 'navigate') targets.add(String(item['action'].screen));
        }
      }
    }

    // Detail screens have their own components; only the config-driven ones
    // need a screen file, so check just those.
    const configDriven = new Set(screenFiles());
    for (const target of targets) {
      if (configDriven.has(target)) expect(bundledConfig.screens[target]).toBeDefined();
    }
  });

  it('bundles all three locales with identical key sets', () => {
    const locales = Object.keys(bundledConfig.translations);
    expect(locales.sort()).toEqual(['en', 'ro', 'ru']);

    const [first, ...rest] = locales;
    const reference = Object.keys(bundledConfig.translations[first!]!).sort();
    for (const locale of rest) {
      expect(Object.keys(bundledConfig.translations[locale]!).sort()).toEqual(reference);
    }
  });

  it('bundles the entity configuration that is on disk', () => {
    const onDisk = JSON.parse(
      readFileSync(join(configDir, 'entities.config.json'), 'utf8'),
    ) as { schemaVersion: number; entities: Array<{ name: string }> };

    expect(bundledConfig.entities.schemaVersion).toBe(onDisk.schemaVersion);
    expect(bundledConfig.entities.entities.map((entity) => entity.name).sort()).toEqual(
      onDisk.entities.map((entity) => entity.name).sort(),
    );
  });
});
