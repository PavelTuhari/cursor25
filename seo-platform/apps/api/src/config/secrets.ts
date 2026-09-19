/**
 * Разрешение ссылок на секреты.
 *
 * В базе лежит только имя (`credentials_ref`), значение берётся отсюда.
 * Поддерживаются две формы: `env:ИМЯ` и `vault://путь`. Vault подключается
 * реализацией VaultResolver — до этого ссылка на него честно не резолвится,
 * а не подменяется тихо переменной окружения.
 */

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

export interface SecretResolver {
  resolve(ref: string): Promise<string>;
  /** Есть ли секрет, без раскрытия значения. */
  has(ref: string): Promise<boolean>;
}

export class EnvSecretResolver implements SecretResolver {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private keyOf(ref: string): string {
    if (ref.startsWith('env:')) return ref.slice(4);
    if (ref.startsWith('vault://')) {
      throw new SecretError(
        `Ссылка ${ref} указывает на Vault, а он не подключён. ` +
          'Подключите VaultResolver либо переведите секрет на env:ИМЯ.',
      );
    }
    // Голое имя трактуем как переменную окружения: так проще в разработке.
    return ref;
  }

  async resolve(ref: string): Promise<string> {
    const key = this.keyOf(ref);
    const value = this.env[key];
    if (!value) {
      throw new SecretError(
        `Секрет "${key}" не найден в окружении. Задайте переменную ${key} ` +
          'или исправьте credentials_ref подключения.',
      );
    }
    return value;
  }

  async has(ref: string): Promise<boolean> {
    try {
      return Boolean(this.env[this.keyOf(ref)]);
    } catch {
      return false;
    }
  }
}

/** Маскирует секрет для логов и ответов API. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
