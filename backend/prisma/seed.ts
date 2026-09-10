import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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
      },
    });
  }

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
