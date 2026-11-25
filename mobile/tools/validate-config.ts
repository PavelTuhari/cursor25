#!/usr/bin/env ts-node
/**
 * Validates a configuration bundle before it is shipped or published to the
 * `/app-config` endpoint.
 *
 *   npm run validate-config              # validates ./config
 *   npm run validate-config -- ./other   # validates another bundle
 */
import { validateConfigBundle } from '../src/config/validate';
import { BLOCK_TYPE_NAMES } from '../src/ui/blocks/blockTypes';
import { loadConfigDir } from './loadConfigDir';

function main(): void {
  const dir = process.argv[2] ?? 'config';
  const bundle = loadConfigDir(dir);
  const result = validateConfigBundle(bundle, [...BLOCK_TYPE_NAMES]);

  for (const warning of result.warnings) {
    process.stdout.write(`warning  ${warning}\n`);
  }
  for (const error of result.errors) {
    process.stdout.write(`error    ${error}\n`);
  }

  const screens = Object.keys(bundle.screens).length;
  const entities = bundle.entities.entities.length;
  process.stdout.write(
    `\n${dir}: ${entities} entities, ${screens} screens, ${bundle.navigation.tabs.length} tabs, ` +
      `${Object.keys(bundle.translations).length} locales\n`,
  );
  process.stdout.write(
    result.valid
      ? `configuration is valid (${result.warnings.length} warnings)\n`
      : `configuration is INVALID (${result.errors.length} errors)\n`,
  );
  process.exit(result.valid ? 0 : 1);
}

main();
