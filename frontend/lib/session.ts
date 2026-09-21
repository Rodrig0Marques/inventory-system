export type UserRole = 'ADMIN' | 'MANAGER' | 'VIEWER';

export type PermissionCode =
  | 'GLOBAL_ASSET_LOOKUP'
  | 'GLOBAL_DASHBOARD_STATS'
  | 'ASSET_CREATE'
  | 'ASSET_EDIT'
  | 'ASSET_DELETE'
  | 'ASSET_MOVE'
  | 'IMPORT_ASSETS'
  | 'POOL_CREATE'
  | 'POOL_EDIT'
  | 'POOL_DELETE'
  | 'CATEGORY_CREATE'
  | 'CATEGORY_EDIT'
  | 'CATEGORY_DELETE'
  | 'FOLDER_CREATE'
  | 'FOLDER_DELETE'
  | 'STOCK_MANAGE'
  | 'NON_PATRIMONIAL_CREATE'
  | 'NON_PATRIMONIAL_EDIT'
  | 'NON_PATRIMONIAL_MOVE'
  | 'NON_PATRIMONIAL_ARCHIVE'
  | 'IMPORT_NON_PATRIMONIAL';

export const managerDefaultPermissions: PermissionCode[] = [
  'ASSET_CREATE',
  'ASSET_EDIT',
  'ASSET_DELETE',
  'ASSET_MOVE',
  'IMPORT_ASSETS',
  'FOLDER_CREATE',
  'FOLDER_DELETE',
  'STOCK_MANAGE',
  'NON_PATRIMONIAL_CREATE',
  'NON_PATRIMONIAL_EDIT',
  'NON_PATRIMONIAL_MOVE',
  'NON_PATRIMONIAL_ARCHIVE',
  'IMPORT_NON_PATRIMONIAL',
];

export function defaultPermissionsForRole(role: UserRole): PermissionCode[] {
  if (role === 'MANAGER') return [...managerDefaultPermissions];
  return [];
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  permissions?: PermissionCode[];
  canGlobalAssetLookup?: boolean;
  canGlobalDashboardStats?: boolean;
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

export function hasPermission(permission: PermissionCode, user: SessionUser | null = getSessionUser()) {
  return user?.role === 'ADMIN' || Boolean(user?.permissions?.includes(permission));
}

// Compatibilidade com telas ainda baseadas no perfil. Novas ações devem usar hasPermission.
export function canManage(role?: UserRole | null) {
  return role === 'ADMIN' || role === 'MANAGER';
}

export function roleLabel(role: UserRole) {
  if (role === 'ADMIN') return 'Administrador';
  if (role === 'MANAGER') return 'Gestor';
  return 'Visualizador';
}
