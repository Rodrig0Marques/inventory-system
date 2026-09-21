import { PermissionCode, PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function defaultPermissionsForRole(role: UserRole): PermissionCode[] {
  if (role === UserRole.ADMIN) return [];
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

async function initializePermissions() {
  const users = await prisma.user.findMany({
    where: { permissionsInitialized: false },
    select: {
      id: true,
      role: true,
      canGlobalAssetLookup: true,
      canGlobalDashboardStats: true,
    },
  });

  for (const user of users) {
    const permissions = new Set(defaultPermissionsForRole(user.role));
    if (user.canGlobalAssetLookup) permissions.add(PermissionCode.GLOBAL_ASSET_LOOKUP);
    if (user.canGlobalDashboardStats) permissions.add(PermissionCode.GLOBAL_DASHBOARD_STATS);

    await prisma.$transaction(async tx => {
      if (permissions.size) {
        await tx.userPermission.createMany({
          data: [...permissions].map(permission => ({ userId: user.id, permission })),
          skipDuplicates: true,
        });
      }
      await tx.user.update({ where: { id: user.id }, data: { permissionsInitialized: true } });
    });
  }
}

async function main() {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    const password = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: {
        name: 'Administrador',
        email: 'admin@inventory.local',
        password,
        role: UserRole.ADMIN,
        permissionsInitialized: true,
      },
    });
  }

  // Migra uma única vez os usuários antigos para o novo modelo granular.
  await initializePermissions();

  const [poolCount, categoryCount, folderCount, auditCount] = await Promise.all([
    prisma.pool.count(),
    prisma.category.count(),
    prisma.folder.count(),
    prisma.auditLog.count(),
  ]);

  // Default catalog is created only on the first initialization.
  // This prevents deleted pools, categories and folders from returning after a restart.
  const firstInitialization = poolCount === 0 && categoryCount === 0 && folderCount === 0 && auditCount === 0;
  if (!firstInitialization) return;

  const pools = [
    { name: 'TI', description: 'Ativos de tecnologia' },
    { name: 'RH', description: 'Ativos administrados pelo RH' },
    { name: 'Administrativo', description: 'Ativos administrativos e gerais' },
  ];

  const createdPools: Record<string, { id: string }> = {};
  for (const pool of pools) {
    createdPools[pool.name] = await prisma.pool.create({ data: pool });
  }

  const categories = [
    'Notebook',
    'Desktop',
    'Monitor',
    'Impressora',
    'Servidor',
    'Switch',
    'Roteador',
    'Access Point',
    'Nobreak',
    'Celular',
    'Tablet',
    'Projetor',
    'Telefone',
    'Mobiliário',
    'Ar-condicionado',
    'Veículo',
    'Ferramenta',
    'Copa e cozinha',
    'Utilidades',
    'Outros',
  ];

  for (const name of categories) {
    await prisma.category.create({ data: { name } });
  }

  const defaultFolders = [
    { pool: 'TI', name: 'Hardware' },
    { pool: 'TI', name: 'Estoque' },
    { pool: 'RH', name: 'Equipamentos' },
    { pool: 'Administrativo', name: 'Patrimônio Geral' },
  ];

  for (const folder of defaultFolders) {
    await prisma.folder.create({ data: { poolId: createdPools[folder.pool].id, name: folder.name } });
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
