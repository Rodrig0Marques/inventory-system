import type { FastifyInstance } from 'fastify';
import { PermissionCode, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';
import { poolWhere, fail } from '../../utils/access.js';
import { hasPermission } from '../../utils/permissions.js';
import type { FastifyRequest } from 'fastify';
import { serial } from '../../utils/transaction.js';

const poolSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(4000).optional().nullable(),
  active: z.boolean().optional(),
});

function stockSummary(profiles: Array<{ availableQty: number; components: Array<{ quantity: number }> }>) {
  const available = profiles.reduce((n, p) => n + p.availableQty, 0);
  const installed = profiles.reduce((n, p) => n + p.components.reduce((a, c) => a + c.quantity, 0), 0);
  return { available, installed, total: available + installed };
}


function assignedPoolWhere(request: FastifyRequest, poolId?: string) {
  if (request.user.role === UserRole.ADMIN) return poolId ? { id: poolId } : {};
  const ids = request.assignedPoolIds ?? [];
  if (poolId && !ids.includes(poolId)) fail(404, 'Setor não encontrado ou sem acesso.');
  return poolId ? { id: poolId } : { id: { in: ids } };
}

function poolListWhere(request: FastifyRequest) {
  return hasPermission(request, PermissionCode.POOL_EDIT) || hasPermission(request, PermissionCode.POOL_DELETE)
    ? assignedPoolWhere(request)
    : poolWhere(request);
}

function poolReadWhere(request: FastifyRequest, poolId: string) {
  return hasPermission(request, PermissionCode.POOL_EDIT) || hasPermission(request, PermissionCode.POOL_DELETE)
    ? assignedPoolWhere(request, poolId)
    : { id: poolId, ...poolWhere(request, poolId) };
}

export async function poolRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);
  const createPermission = { preHandler: app.requirePermission(PermissionCode.POOL_CREATE) };
  const editPermission = { preHandler: app.requirePermission(PermissionCode.POOL_EDIT) };
  const deletePermission = { preHandler: app.requirePermission(PermissionCode.POOL_DELETE) };

  app.get('/', async request => {
    const pools = await prisma.pool.findMany({
      where: poolListWhere(request),
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { assets: true, folders: true, nonPatrimonialItems: { where: { active: true } } } },
        profiles: {
          where: { active: true },
          select: { availableQty: true, components: { where: { removedAt: null }, select: { quantity: true } } },
        },
      },
    });
    return pools.map(({ profiles, ...pool }) => ({ ...pool, stock: stockSummary(profiles) }));
  });

  app.get('/:id', async request => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const pool = await prisma.pool.findFirst({
      where: poolReadWhere(request, id),
      include: {
        _count: { select: { assets: true, folders: true, nonPatrimonialItems: { where: { active: true } } } },
        profiles: {
          where: { active: true },
          select: { availableQty: true, components: { where: { removedAt: null }, select: { quantity: true } } },
        },
      },
    });
    if (!pool) fail(404, 'Setor não encontrado ou sem acesso.');
    const [assetCategoryGroups, nonPatrimonialCategoryGroups] = await Promise.all([
      prisma.asset.groupBy({ by: ['categoryId'], where: { poolId: id }, _count: { _all: true } }),
      prisma.nonPatrimonialItem.groupBy({ by: ['categoryId'], where: { poolId: id, active: true }, _count: { _all: true } }),
    ]);
    const categoryIds = new Set([...assetCategoryGroups, ...nonPatrimonialCategoryGroups].map(item => item.categoryId));
    const { profiles, ...data } = pool;
    return { ...data, stock: stockSummary(profiles), categoryCount: categoryIds.size };
  });

  app.post('/', createPermission, async (request, reply) => {
    const data = poolSchema.parse(request.body);
    const pool = await serial(async tx => {
      const item = await tx.pool.create({ data });
      // Quem cria um Pool fora do perfil ADMIN recebe acesso ao novo Pool automaticamente.
      if (request.user.role !== UserRole.ADMIN) {
        await tx.userPool.create({ data: { userId: request.user.sub, poolId: item.id } });
      }
      await audit(request, 'CREATE', 'Pool', item.id, undefined, item, tx);
      return item;
    });
    return reply.status(201).send(pool);
  });

  app.put('/:id', editPermission, async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const data = poolSchema.partial().parse(request.body);
    return serial(async tx => {
      const old = await tx.pool.findFirst({ where: assignedPoolWhere(request, id) });
      if (!old) fail(404, 'Setor não encontrado.');
      const updated = await tx.pool.update({ where: { id }, data });
      await audit(request, 'UPDATE', 'Pool', id, old, updated, tx);
      return updated;
    });
  });

  app.delete('/:id', deletePermission, async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return serial(async tx => {
      const pool = await tx.pool.findFirst({ where: assignedPoolWhere(request, id), include: { _count: { select: { assets: true, folders: true, profiles: true, nonPatrimonialItems: true } } } });
      if (!pool) fail(404, 'Setor não encontrado.');
      if (pool._count.assets || pool._count.folders || pool._count.profiles || pool._count.nonPatrimonialItems) {
        fail(409, 'Este Setor possui ativos, pastas, perfis de estoque ou itens não patrimoniados. Reorganize os dados ou inative o Setor para preservar o histórico.');
      }
      await tx.pool.delete({ where: { id } });
      await audit(request, 'DELETE', 'Pool', id, pool, undefined, tx);
      return { message: 'Setor excluído.' };
    });
  });
}
