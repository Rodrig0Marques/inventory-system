import type { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';
import { fail, poolScope, writablePool } from '../../utils/access.js';
import { serial } from '../../utils/transaction.js';

export async function folderRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);
  const write = { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) };
  app.get('/', async request => {
    const q = z.object({ poolId: z.string().optional() }).parse(request.query);
    return prisma.folder.findMany({ where: poolScope(request, q.poolId), include: { pool: true, _count: { select: { assets: { where: poolScope(request) }, children: { where: poolScope(request) } } } }, orderBy: [{ pool: { name: 'asc' } }, { name: 'asc' }] });
  });
  app.post('/', write, async (request, reply) => {
    const data = z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(4000).optional().nullable(), poolId: z.string().min(1), parentId: z.string().optional().nullable() }).parse(request.body);
    const result = await serial(async tx => {
      await writablePool(request, data.poolId, tx);
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`folders:${data.poolId}`}))`;
      if (data.parentId && !await tx.folder.findFirst({ where: { id: data.parentId, poolId: data.poolId } })) fail(400, 'A pasta pai deve pertencer ao mesmo Pool.');
      if (await tx.folder.findFirst({ where: { name: data.name, poolId: data.poolId, parentId: data.parentId ?? null } })) fail(409, 'Já existe uma pasta com esse nome neste nível.');
      const folder = await tx.folder.create({ data }); await audit(request, 'CREATE', 'Folder', folder.id, undefined, folder, tx); return folder;
    });
    return reply.status(201).send(result);
  });
  app.delete('/:id', write, async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return serial(async tx => {
      const folder = await tx.folder.findFirst({ where: { id, ...poolScope(request) }, include: { _count: { select: { assets: true, children: true } } } });
      if (!folder) fail(404, 'Pasta não encontrada ou sem acesso.');
      await writablePool(request, folder.poolId, tx);
      if (folder._count.assets || folder._count.children) fail(409, 'Esta pasta possui ativos ou subpastas. Reorganize os itens antes de excluir.');
      await tx.folder.delete({ where: { id } }); await audit(request, 'DELETE', 'Folder', id, folder, undefined, tx);
      return { message: 'Pasta excluída.' };
    });
  });
}
