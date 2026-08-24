/** Ошибка с осмысленным HTTP-кодом. Всё остальное — 500 и запись в лог. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static notFound(what: string): ApiError {
    return new ApiError(404, `${what} не найден`);
  }
  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }
  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }
  static forbidden(message: string): ApiError {
    return new ApiError(403, message);
  }
}
