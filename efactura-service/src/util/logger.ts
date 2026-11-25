/**
 * Structured logging to stdout as one JSON object per line - what systemd,
 * Docker and OCI Logging all ingest without extra configuration.
 */
import type { LogLevel } from '../config/types.js';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** Keys whose values are replaced before anything reaches the log. */
const SECRET_KEYS = /password|passphrase|apikey|token|secret|authorization/i;

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.test(key)) out[key] = '***';
    else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date))
      out[key] = redact(value as Record<string, unknown>);
    else out[key] = value;
  }
  return out;
}

export function createLogger(
  level: LogLevel,
  bindings: Record<string, unknown> = {},
  write: (line: string) => void = (line) => process.stdout.write(line + '\n'),
): Logger {
  const threshold = ORDER[level];

  const emit = (severity: LogLevel, event: string, fields?: Record<string, unknown>) => {
    if (ORDER[severity] < threshold) return;
    write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: severity,
        event,
        ...redact(bindings),
        ...redact(fields ?? {}),
      }),
    );
  };

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (extra) => createLogger(level, { ...bindings, ...extra }, write),
  };
}
