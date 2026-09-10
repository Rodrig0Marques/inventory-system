import type { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';

const folderSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  poolId: z.string(),
  parentId: z.string().optional().nullable(),
});

export async function folderRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (request) => {
    const query = z.object({ poolId: z.string().optional() }).parse(request.query);
    return prisma.folder.findMany({
      where: query.poolId ? { poolId: query.poolId } : undefined,
      include: { pool: true, _count: { select: { assets: true, children: true } } },
      orderBy: [{ pool: { name: 'asc' } }, { name: 'asc' }],
    });
  });

  app.post('/', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const data = folderSchema.parse(request.body);

    if (data.parentId) {
      const parent = await prisma.folder.findUnique({ where: { id: data.parentId } });
      if (!parent || parent.poolId !== data.poolId) {
        return reply.status(400).send({ message: 'A pasta pai precisa pertencer ao mesmo pool' });
      }
    }

    const folder = await prisma.folder.create({ data });
    await audit(request, 'CREATE', 'Folder', folder.id, undefined, folder);
    return reply.status(201).send(folder);
  });

  app.delete('/:id', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const folder = await prisma.folder.findUnique({
      where: { id },
      include: {
        pool: true,
        _count: { select: { assets: true, children: true } },
      },
    });

    if (!folder) return reply.status(404).send({ message: 'Pasta não encontrada' });
    if (folder._count.assets > 0) {
      return reply.status(409).send({
        message: `Não é possível excluir esta pasta: existem ${folder._count.assets} ativo(s) nela. Mova ou exclua os ativos primeiro.`,
      });
    }
    if (folder._count.children > 0) {
      return reply.status(409).send({
        message: `Não é possível excluir esta pasta: existem ${folder._count.children} subpasta(s). Exclua ou reorganize as subpastas primeiro.`,
      });
    }

    await prisma.folder.delete({ where: { id } });
    await audit(request, 'DELETE', 'Folder', id, folder, undefined);
    return reply.send({ message: 'Pasta excluída com sucesso' });
  });
}
