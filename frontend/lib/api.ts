import { clearSession, getToken } from './session';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export { getToken } from './session';

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  const token = getToken();

  if (token) headers.set('Authorization', `Bearer ${token}`);

  if (options.body != null && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  } else {
    headers.delete('Content-Type');
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    cache: 'no-store',
  });

  if (response.status === 401 && typeof window !== 'undefined') {
    clearSession();
    if (window.location.pathname !== '/login') window.location.href = '/login';
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `Erro HTTP ${response.status}`);
  }

  return response.json();
}
