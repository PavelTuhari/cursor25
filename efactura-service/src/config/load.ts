/**
 * Configuration loading: JSON file, then environment overrides, then validation.
 *
 * The environment always wins, so the same image can be shipped to every client
 * and pointed at a different database, SFS account and certificate purely by
 * environment - which is what makes the service installable standalone.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AppConfig } from './types.js';
import { validateConfig } from './validate.js';

const ENV_PREFIX = 'EFACT__';

/** Default location, overridable with EFACT_CONFIG. */
export function configPath(): string {
  return process.env.EFACT_CONFIG
    ? resolve(process.env.EFACT_CONFIG)
    : resolve(process.cwd(), 'config', 'service.config.json');
}

type Json = Record<string, unknown>;

/**
 * Coerces a string from the environment to the type of the value it replaces,
 * so that `EFACT__WORKER__BATCHSIZE=50` yields a number and not `"50"`.
 */
function coerce(previous: unknown, raw: string): unknown {
  if (typeof previous === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`expected a number, got ${JSON.stringify(raw)}`);
    return n;
  }
  if (typeof previous === 'boolean') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    throw new Error(`expected a boolean, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

/**
 * Walks `EFACT__A__B=value` onto `config.a.b`. Keys are matched
 * case-insensitively against the keys that already exist in the JSON, so a typo
 * in a variable name is reported rather than silently creating a dead key.
 */
export function applyEnvOverrides(
  config: Json,
  env: NodeJS.ProcessEnv = process.env,
): { config: Json; applied: string[]; unknown: string[] } {
  const applied: string[] = [];
  const unknown: string[] = [];

  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith(ENV_PREFIX) || raw === undefined) continue;
    const segments = name.slice(ENV_PREFIX.length).split('__').filter(Boolean);
    if (segments.length === 0) continue;

    let cursor: Json = config;
    let ok = true;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const key = Object.keys(cursor).find((k) => k.toLowerCase() === segments[i]!.toLowerCase());
      const next = key === undefined ? undefined : cursor[key];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        ok = false;
        break;
      }
      cursor = next as Json;
    }
    if (!ok) {
      unknown.push(name);
      continue;
    }

    const last = segments[segments.length - 1]!;
    const key = Object.keys(cursor).find((k) => k.toLowerCase() === last.toLowerCase());
    if (key === undefined) {
      unknown.push(name);
      continue;
    }
    try {
      cursor[key] = coerce(cursor[key], raw);
      applied.push(name);
    } catch (error) {
      throw new Error(`${name}: ${(error as Error).message}`);
    }
  }

  return { config, applied, unknown };
}

export interface LoadResult {
  config: AppConfig;
  path: string;
  appliedEnv: string[];
  unknownEnv: string[];
}

export function loadConfig(path = configPath()): LoadResult {
  let parsed: Json;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Json;
  } catch (error) {
    throw new Error(`cannot read configuration ${path}: ${(error as Error).message}`);
  }

  const { config, applied, unknown } = applyEnvOverrides(parsed);
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(`invalid configuration ${path}:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    config: config as unknown as AppConfig,
    path,
    appliedEnv: applied,
    unknownEnv: unknown,
  };
}
