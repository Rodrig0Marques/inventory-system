-- Additive, repeatable upgrade. No tables/rows are deleted.
ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';

-- Preserve the old manager defaults and legacy global grants before switching
-- initialized accounts to UserPermission as their single source of authority.
INSERT INTO "UserPermission" ("userId", "permission")
SELECT u.id, p.permission
FROM "User" u
CROSS JOIN unnest(ARRAY[
 'ASSET_CREATE','ASSET_EDIT','ASSET_DELETE','ASSET_MOVE','IMPORT_ASSETS',
 'FOLDER_CREATE','FOLDER_DELETE','STOCK_MANAGE','NON_PATRIMONIAL_CREATE',
 'NON_PATRIMONIAL_EDIT','NON_PATRIMONIAL_MOVE','NON_PATRIMONIAL_ARCHIVE','IMPORT_NON_PATRIMONIAL'
]::"PermissionCode"[]) AS p(permission)
WHERE u.role = 'MANAGER' AND NOT u."permissionsInitialized"
ON CONFLICT DO NOTHING;
INSERT INTO "UserPermission" ("userId", "permission")
SELECT id, 'GLOBAL_ASSET_LOOKUP'::"PermissionCode" FROM "User"
WHERE NOT "permissionsInitialized" AND "canGlobalAssetLookup"
UNION ALL
SELECT id, 'GLOBAL_DASHBOARD_STATS'::"PermissionCode" FROM "User"
WHERE NOT "permissionsInitialized" AND "canGlobalDashboardStats"
ON CONFLICT DO NOTHING;
UPDATE "User" SET "permissionsInitialized" = true WHERE NOT "permissionsInitialized";
