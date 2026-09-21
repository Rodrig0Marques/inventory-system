import { PermissionCode, UserRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

export const ALL_PERMISSIONS = Object.values(PermissionCode);

export function defaultPermissionsForRole(role: UserRole): PermissionCode[] {
  if (role === UserRole.ADMIN) return [...ALL_PERMISSIONS];
  if (role === UserRole.MANAGER) {
    return [
      PermissionCode.ASSET_CREATE,
      PermissionCode.ASSET_EDIT,
      PermissionCode.ASSET_DELETE,
      PermissionCode.ASSET_MOVE,
      PermissionCode.IMPORT_ASSETS,
      PermissionCode.FOLDER_CREATE,
      PermissionCode.FOLDER_DELETE,
      PermissionCode.STOCK_MANAGE,
      PermissionCode.NON_PATRIMONIAL_CREATE,
      PermissionCode.NON_PATRIMONIAL_EDIT,
      PermissionCode.NON_PATRIMONIAL_MOVE,
      PermissionCode.NON_PATRIMONIAL_ARCHIVE,
      PermissionCode.IMPORT_NON_PATRIMONIAL,
    ];
  }
  return [];
}

export function effectivePermissions(
  role: UserRole,
  stored: readonly PermissionCode[],
  legacy?: { canGlobalAssetLookup?: boolean; canGlobalDashboardStats?: boolean },
): PermissionCode[] {
  if (role === UserRole.ADMIN) return [...ALL_PERMISSIONS];
  const result = new Set<PermissionCode>(stored);
  if (legacy?.canGlobalAssetLookup) result.add(PermissionCode.GLOBAL_ASSET_LOOKUP);
  if (legacy?.canGlobalDashboardStats) result.add(PermissionCode.GLOBAL_DASHBOARD_STATS);
  return [...result];
}

export function hasPermission(request: FastifyRequest, permission: PermissionCode) {
  return request.user?.role === UserRole.ADMIN || request.permissions.includes(permission);
}
