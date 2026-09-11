export type UserRole = 'ADMIN' | 'MANAGER' | 'VIEWER';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  poolIds?: string[] | null;
};

const TOKEN_KEY = 'inventory_token';
const USER_KEY = 'inventory_user';

export function getToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function getSessionUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function setSession(token: string, user: SessionUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function setSessionUser(user: SessionUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function canManage(role?: UserRole | null) {
  return role === 'ADMIN' || role === 'MANAGER';
}

export function roleLabel(role: UserRole) {
  if (role === 'ADMIN') return 'Administrador';
  if (role === 'MANAGER') return 'Gestor';
  return 'Visualizador';
}
