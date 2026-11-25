/** `npm run validate-config` - fails the build or the deployment before it ships. */
import { configPath, loadConfig } from './load.js';

try {
  const { config, path, appliedEnv, unknownEnv } = loadConfig();
  process.stdout.write(`configuration is valid: ${path}\n`);
  process.stdout.write(
    `  tenant=${config.service.tenantId} endpoint=${config.sfs.endpoint} ` +
      `signing=${config.signing.mode} worker=${config.worker.enabled ? 'on' : 'off'}\n`,
  );
  if (appliedEnv.length > 0) {
    process.stdout.write(`  overridden from the environment: ${appliedEnv.join(', ')}\n`);
  }
  if (unknownEnv.length > 0) {
    process.stdout.write(`  WARNING - unknown variables ignored: ${unknownEnv.join(', ')}\n`);
  }
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.stderr.write(`  file: ${configPath()}\n`);
  process.exit(1);
}
