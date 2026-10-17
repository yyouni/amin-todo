import type { ApiError } from '@todo/contracts';

export class RequestError extends Error {
  constructor(
    public status: number,
    public payload: ApiError['error'],
  ) {
    super(payload.message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
  }
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => ({
        error: { code: 'SERVER_ERROR', message: 'Сервер недоступен. Попробуйте позже.' },
      }))) as ApiError;
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('todo:unauthorized'));
    throw new RequestError(response.status, payload.error);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
