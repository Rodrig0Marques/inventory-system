import type { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';
import { poolWhere, fail } from '../../utils/access.js';
import { serial } from '../../utils/transaction.js';

const poolSchema = z.object({ name: z.string().trim().min(2).max(100), description: z.string().trim().max(4000).optional().nullable(), active: z.boolean().optional() });
export async function poolRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);
  const admin = { preHandler: app.authorize([UserRole.ADMIN]) };
  app.get('/', async request => {
    const pools = await prisma.pool.findMany({ where: poolWhere(request), orderBy: { name: 'asc' }, include: {
      _count: { select: { assets: true, folders: true } },
      profiles: { where: { active: true }, select: { availableQty: true, components: { where: { removedAt: null }, select: { quantity: true } } } },
    } });
    return pools.map(({ profiles, ...pool }) => {
      const available = profiles.reduce((n,p) => n + p.availableQty, 0);
      const installed = profiles.reduce((n,p) => n + p.components.reduce((a,c) => a+c.quantity, 0), 0);
      return { ...pool, stock: { available, installed, total: available+installed } };
    });
  });
  app.post('/', admin, async (request, reply) => {
    const data = poolSchema.parse(request.body);
    const pool = await serial(async tx => {
      const item = await tx.pool.create({ data }); await audit(request, 'CREATE', 'Pool', item.id, undefined, item, tx); return item;
    });
    return reply.status(201).send(pool);
  });
  app.put('/:id', admin, async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params); const data = poolSchema.partial().parse(request.body);
    return serial(async tx => {
      const old = await tx.pool.findUnique({ where: { id } }); if (!old) fail(404, 'Pool não encontrado.');
      const updated = await tx.pool.update({ where: { id }, data }); await audit(request, 'UPDATE', 'Pool', id, old, updated, tx); return updated;
    });
  });
  app.delete('/:id', admin, async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return serial(async tx => {
      const pool = await tx.pool.findUnique({ where: { id }, include: { _count: { select: { assets: true, folders: true, profiles: true } } } });
      if (!pool) fail(404, 'Pool não encontrado.');
      if (pool._count.assets || pool._count.folders || pool._count.profiles) fail(409, 'Este Pool possui ativos, pastas ou perfis de estoque. Reorganize os dados ou inative o Pool para preservar o histórico.');
      await tx.pool.delete({ where: { id } }); await audit(request, 'DELETE', 'Pool', id, pool, undefined, tx);
      return { message: 'Pool excluído.' };
    });
  });
}
