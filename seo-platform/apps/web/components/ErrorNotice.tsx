import { ApiCallError } from '@/lib/api';

/** Единая подача ошибки API: пользователь должен понимать, что чинить. */
export function ErrorNotice({ error }: { error: unknown }) {
  const message = error instanceof ApiCallError ? error.message : String(error);
  const isDown = error instanceof ApiCallError && error.status === 503;
  return (
    <div className="notice error">
      <strong>{isDown ? 'API платформы недоступен' : 'Ошибка запроса'}</strong>
      <div style={{ marginTop: 6 }}>{message}</div>
      {isDown && (
        <div style={{ marginTop: 8 }} className="hint">
          Запустите API: <span className="mono">npm run api:dev</span> — и проверьте API_URL.
        </div>
      )}
    </div>
  );
}
