import type { FastifyInstance } from 'fastify';
import { CustomFieldType, PermissionCode } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';
import { descendants, poolScope } from '../../utils/access.js';

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (request) => prisma.category.findMany({
    include: {
      assetTypes: true,
      customFields: true,
      _count: { select: { assets: { where: poolScope(request) }, nonPatrimonialItems: { where: { ...poolScope(request), active: true } } } },
    },
    orderBy: { name: 'asc' },
  }));

  app.post('/', { preHandler: app.requirePermission(PermissionCode.CATEGORY_CREATE) }, async (request, reply) => {
    const data = z.object({
      name: z.string().trim().min(1),
      description: z.string().trim().optional().nullable(),
      parentId: z.string().min(1).optional().nullable(),
    }).parse(request.body);

    if (data.parentId && !await prisma.category.findUnique({ where: { id: data.parentId } })) return reply.status(400).send({ message: 'Categoria pai não encontrada.' });
    const existing = await prisma.category.findUnique({ where: { name: data.name } });
    if (existing) return reply.status(409).send({ message: 'Já existe uma categoria com esse nome' });

    const result = await prisma.category.create({ data });
    await audit(request, 'CREATE', 'Category', result.id, undefined, result);
    return reply.status(201).send(result);
  });

  app.put('/:id', { preHandler: app.requirePermission(PermissionCode.CATEGORY_EDIT) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const data = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(4000).optional().nullable(),
      parentId: z.string().min(1).optional().nullable(),
    }).refine(value => Object.keys(value).length > 0, { message: 'Informe ao menos um campo para alterar.' }).parse(request.body);

    const before = await prisma.category.findUnique({ where: { id } });
    if (!before) return reply.status(404).send({ message: 'Categoria não encontrada' });

    if (data.name && data.name !== before.name) {
      const duplicate = await prisma.category.findUnique({ where: { name: data.name } });
      if (duplicate) return reply.status(409).send({ message: 'Já existe uma categoria com esse nome' });
    }

    if (data.parentId !== undefined) {
      if (data.parentId === id) return reply.status(400).send({ message: 'Uma categoria não pode ser pai dela mesma.' });
      if (data.parentId) {
        const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
        if (!parent) return reply.status(400).send({ message: 'Categoria pai não encontrada.' });
        const categories = await prisma.category.findMany({ select: { id: true, parentId: true } });
        if (descendants(categories, id).includes(data.parentId)) {
          return reply.status(400).send({ message: 'A categoria pai não pode ser uma subcategoria da própria categoria.' });
        }
      }
    }

    const result = await prisma.category.update({ where: { id }, data });
    await audit(request, 'UPDATE', 'Category', id, before, result);
    return reply.send(result);
  });

  app.delete('/:id', { preHandler: app.requirePermission(PermissionCode.CATEGORY_DELETE) }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { assets: true, children: true, profiles: true, nonPatrimonialItems: true } } },
    });

    if (!category) return reply.status(404).send({ message: 'Categoria não encontrada' });
    if (category._count.assets > 0) {
      return reply.status(409).send({
        message: `Não é possível excluir esta categoria: existem ${category._count.assets} ativo(s) vinculado(s). Altere ou exclua os ativos primeiro.`,
      });
    }

    if (category._count.children || category._count.profiles || category._count.nonPatrimonialItems) return reply.status(409).send({ message: 'A categoria possui subcategorias, perfis de estoque ou itens não patrimoniados. O histórico não pode ser apagado.' });
    await prisma.category.delete({ where: { id } });
    await audit(request, 'DELETE', 'Category', id, category, undefined);
    return reply.send({ message: 'Categoria excluída com sucesso' });
  });

  app.post('/:id/types', { preHandler: app.requirePermission(PermissionCode.CATEGORY_EDIT) }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { name } = z.object({ name: z.string().trim().min(1) }).parse(request.body);
    const result = await prisma.assetType.create({ data: { categoryId: id, name } });
    await audit(request, 'CREATE', 'AssetType', result.id, undefined, result);
    return reply.status(201).send(result);
  });

  app.post('/:id/fields', { preHandler: app.requirePermission(PermissionCode.CATEGORY_EDIT) }, async (request, reply) => {
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
