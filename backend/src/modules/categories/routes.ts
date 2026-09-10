import type { FastifyInstance } from 'fastify';
import { CustomFieldType, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => prisma.category.findMany({
    include: {
      assetTypes: true,
      customFields: true,
      _count: { select: { assets: true } },
    },
    orderBy: { name: 'asc' },
  }));

  app.post('/', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const data = z.object({
      name: z.string().trim().min(1),
      description: z.string().trim().optional().nullable(),
    }).parse(request.body);

    const existing = await prisma.category.findUnique({ where: { name: data.name } });
    if (existing) return reply.status(409).send({ message: 'Já existe uma categoria com esse nome' });

    const result = await prisma.category.create({ data });
    await audit(request, 'CREATE', 'Category', result.id, undefined, result);
    return reply.status(201).send(result);
  });

  app.delete('/:id', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { assets: true } } },
    });

    if (!category) return reply.status(404).send({ message: 'Categoria não encontrada' });
    if (category._count.assets > 0) {
      return reply.status(409).send({
        message: `Não é possível excluir esta categoria: existem ${category._count.assets} ativo(s) vinculado(s). Altere ou exclua os ativos primeiro.`,
      });
    }

    await prisma.category.delete({ where: { id } });
    await audit(request, 'DELETE', 'Category', id, category, undefined);
    return reply.send({ message: 'Categoria excluída com sucesso' });
  });

  app.post('/:id/types', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { name } = z.object({ name: z.string().trim().min(1) }).parse(request.body);
    const result = await prisma.assetType.create({ data: { categoryId: id, name } });
    await audit(request, 'CREATE', 'AssetType', result.id, undefined, result);
    return reply.status(201).send(result);
  });

  app.post('/:id/fields', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const data = z.object({
      name: z.string().trim().min(1),
      key: z.string().regex(/^[a-z0-9_]+$/),
      type: z.nativeEnum(CustomFieldType),
      required: z.boolean().optional(),
      options: z.array(z.string()).optional(),
    }).parse(request.body);
    const result = await prisma.customField.create({ data: { ...data, categoryId: id } });
    await audit(request, 'CREATE', 'CustomField', result.id, undefined, result);
    return reply.status(201).send(result);
  });
}
