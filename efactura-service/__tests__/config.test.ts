import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { applyEnvOverrides } from '../src/config/load.js';
import { validateConfig } from '../src/config/validate.js';

function shipped(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'config', 'service.config.json'), 'utf8'),
  ) as Record<string, unknown>;
}

test('the shipped configuration is valid', () => {
  assert.deepEqual(validateConfig(shipped()), []);
});

test('environment overrides reach nested keys and keep their type', () => {
  const { config, applied, unknown } = applyEnvOverrides(shipped(), {
    EFACT__SFS__USERNAME: 'supplier',
    EFACT__WORKER__BATCHSIZE: '50',
    EFACT__WORKER__ENABLED: 'false',
    EFACT__SERVICE__HTTP__PORT: '9000',
  } as NodeJS.ProcessEnv);

  const sfs = config['sfs'] as Record<string, unknown>;
  const worker = config['worker'] as Record<string, unknown>;
  const http = (config['service'] as Record<string, unknown>)['http'] as Record<string, unknown>;

  assert.equal(sfs['username'], 'supplier');
  assert.equal(worker['batchSize'], 50);
  assert.equal(worker['enabled'], false);
  assert.equal(http['port'], 9000);
  assert.equal(applied.length, 4);
  assert.deepEqual(unknown, []);
});

test('a misspelled variable is reported rather than silently ignored', () => {
  const { unknown } = applyEnvOverrides(shipped(), {
    EFACT__SFS__USERNMAE: 'typo',
    EFACT__NOSUCHSECTION__KEY: 'x',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(unknown.sort(), ['EFACT__NOSUCHSECTION__KEY', 'EFACT__SFS__USERNMAE']);
});

test('a non-numeric override for a numeric key fails loudly', () => {
  assert.throws(
    () => applyEnvOverrides(shipped(), { EFACT__WORKER__BATCHSIZE: 'many' } as NodeJS.ProcessEnv),
    /expected a number/,
  );
});

test('plain http is refused for a remote endpoint but allowed for a local mock', () => {
  const remote = shipped();
  (remote['sfs'] as Record<string, unknown>)['endpoint'] = 'http://efactura-api.sfs.md/Service.svc';
  assert.ok(validateConfig(remote).some((error) => error.includes('must use https')));

  const local = shipped();
  (local['sfs'] as Record<string, unknown>)['endpoint'] = 'http://127.0.0.1:4010/Service.svc';
  assert.deepEqual(validateConfig(local), []);
});

test('a signing mode without its settings is rejected', () => {
  const config = shipped();
  (config['signing'] as Record<string, unknown>)['mode'] = 'pkcs12';
  assert.ok(validateConfig(config).some((error) => error.includes('signing.pkcs12.file')));

  const pki = shipped();
  (pki['signing'] as Record<string, unknown>)['mode'] = 'pkiserver';
  const errors = validateConfig(pki);
  assert.ok(errors.some((error) => error.includes('signing.pkiServer.url')));
  assert.ok(errors.some((error) => error.includes('signing.pkiServer.keyAlias')));
});

test('poolMin above poolMax is rejected', () => {
  const config = shipped();
  const oracle = config['oracle'] as Record<string, unknown>;
  oracle['poolMin'] = 20;
  oracle['poolMax'] = 8;
  assert.ok(validateConfig(config).some((error) => error.includes('must not exceed')));
});
