import type { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';

const poolSchema = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().optional().nullable(),
  active: z.boolean().optional(),
});

export async function poolRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => prisma.pool.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { assets: true, folders: true } } },
  }));

  app.post('/', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const data = poolSchema.parse(request.body);
    const existing = await prisma.pool.findUnique({ where: { name: data.name } });
    if (existing) return reply.status(409).send({ message: 'Já existe um pool com esse nome' });

    const pool = await prisma.pool.create({ data });
    await audit(request, 'CREATE', 'Pool', pool.id, undefined, pool);
    return reply.status(201).send(pool);
  });

  app.put('/:id', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const data = poolSchema.partial().parse(request.body);
    const previous = await prisma.pool.findUnique({ where: { id } });
    if (!previous) return reply.status(404).send({ message: 'Pool não encontrado' });

    const updated = await prisma.pool.update({ where: { id }, data });
    await audit(request, 'UPDATE', 'Pool', id, previous, updated);
    return updated;
  });

  app.delete('/:id', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const pool = await prisma.pool.findUnique({
      where: { id },
      include: { _count: { select: { assets: true, folders: true } } },
    });

    if (!pool) return reply.status(404).send({ message: 'Pool não encontrado' });
    if (pool._count.assets > 0) {
      return reply.status(409).send({
        message: `Não é possível excluir este pool: existem ${pool._count.assets} ativo(s) vinculado(s). Mova ou exclua os ativos primeiro.`,
      });
    }

    await prisma.pool.delete({ where: { id } });
    await audit(request, 'DELETE', 'Pool', id, pool, undefined);
    return reply.send({ message: 'Pool excluído com sucesso' });
  });
}
