import type { FastifyInstance } from 'fastify';
import { AssetStatus, Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';

const assetSchema = z.object({
  patrimonyNumber: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  purchasePrice: z.coerce.number().nonnegative().optional().nullable(),
  purchaseDate: z.string().datetime().optional().nullable(),
  status: z.nativeEnum(AssetStatus).optional(),
  location: z.string().optional().nullable(),
  responsible: z.string().optional().nullable(),
  poolId: z.string(),
  folderId: z.string().optional().nullable(),
  categoryId: z.string(),
  assetTypeId: z.string().optional().nullable(),
  customValues: z.record(z.any()).optional(),
});

export async function assetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/summary', async () => {
    const [total, byStatus, value] = await Promise.all([
      prisma.asset.count(),
      prisma.asset.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.asset.aggregate({ _sum: { purchasePrice: true } }),
    ]);
    return { total, byStatus, totalValue: value._sum.purchasePrice ?? 0 };
  });

  app.get('/', async (request) => {
    const q = z.object({
      search: z.string().optional(),
      poolId: z.string().optional(),
      categoryId: z.string().optional(),
      status: z.nativeEnum(AssetStatus).optional(),
      page: z.coerce.number().int().positive().default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
    }).parse(request.query);

    const where: Prisma.AssetWhereInput = {
      poolId: q.poolId,
      categoryId: q.categoryId,
      status: q.status,
      ...(q.search ? {
        OR: [
          { patrimonyNumber: { contains: q.search, mode: 'insensitive' } },
          { name: { contains: q.search, mode: 'insensitive' } },
          { serialNumber: { contains: q.search, mode: 'insensitive' } },
          { manufacturer: { contains: q.search, mode: 'insensitive' } },
          { model: { contains: q.search, mode: 'insensitive' } },
          { description: { contains: q.search, mode: 'insensitive' } },
          { location: { contains: q.search, mode: 'insensitive' } },
          { responsible: { contains: q.search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        include: { pool: true, folder: true, category: true, assetType: true, customValues: { include: { customField: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.asset.count({ where }),
    ]);

    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const asset = await prisma.asset.findUnique({
      where: { id },
      include: { pool: true, folder: true, category: { include: { customFields: true } }, assetType: true, customValues: { include: { customField: true } }, movements: { orderBy: { createdAt: 'desc' } } },
    });
    if (!asset) return reply.status(404).send({ message: 'Ativo não encontrado' });
    return asset;
  });

  app.post('/', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const data = assetSchema.parse(request.body);
    const { customValues = {}, purchasePrice, purchaseDate, ...base } = data;

    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          ...base,
          purchasePrice: purchasePrice == null ? null : new Prisma.Decimal(purchasePrice),
          purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
        },
      });

      // Campos customizados continuam suportados pela API, mas nao sao obrigatorios
      // no formulario simplificado de cadastro.
      if (Object.keys(customValues).length > 0) {
        const fields = await tx.customField.findMany({ where: { categoryId: data.categoryId } });
        for (const field of fields) {
          const value = customValues[field.key];
          if (value !== undefined) {
            await tx.assetCustomValue.create({ data: { assetId: created.id, customFieldId: field.id, value } });
          }
        }
      }
      return created;
    });

    await audit(request, 'CREATE', 'Asset', asset.id, undefined, data);
    return reply.status(201).send(asset);
  });

  app.put('/:id', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const data = assetSchema.partial().parse(request.body);
    const previous = await prisma.asset.findUniqueOrThrow({ where: { id } });
    const { customValues, purchasePrice, purchaseDate, ...base } = data;

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        ...base,
        ...(purchasePrice !== undefined ? { purchasePrice: purchasePrice == null ? null : new Prisma.Decimal(purchasePrice) } : {}),
        ...(purchaseDate !== undefined ? { purchaseDate: purchaseDate ? new Date(purchaseDate) : null } : {}),
      },
    });

    if (customValues) {
      const fields = await prisma.customField.findMany({ where: { categoryId: updated.categoryId } });
      for (const field of fields) {
        if (customValues[field.key] !== undefined) {
          await prisma.assetCustomValue.upsert({
            where: { assetId_customFieldId: { assetId: id, customFieldId: field.id } },
            update: { value: customValues[field.key] },
            create: { assetId: id, customFieldId: field.id, value: customValues[field.key] },
          });
        }
      }
    }

    await audit(request, 'UPDATE', 'Asset', id, previous, data);
    return updated;
  });

  app.delete('/:id', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const previous = await prisma.asset.findUnique({ where: { id } });

    if (!previous) {
      return reply.status(404).send({ message: 'Ativo não encontrado' });
    }

    await prisma.asset.delete({ where: { id } });
    await audit(request, 'DELETE', 'Asset', id, previous, undefined);

    return reply.send({ message: 'Ativo excluído com sucesso' });
  });

  app.post('/:id/move', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      poolId: z.string().optional(),
      folderId: z.string().optional().nullable(),
      location: z.string().optional().nullable(),
      responsible: z.string().optional().nullable(),
      notes: z.string().optional(),
    }).parse(request.body);

    const current = await prisma.asset.findUniqueOrThrow({ where: { id } });
    const updated = await prisma.$transaction(async (tx) => {
      await tx.assetMovement.create({
        data: {
          assetId: id,
          fromPoolId: current.poolId,
          toPoolId: body.poolId ?? current.poolId,
          fromFolderId: current.folderId,
          toFolderId: body.folderId === undefined ? current.folderId : body.folderId,
          fromLocation: current.location,
          toLocation: body.location === undefined ? current.location : body.location,
          fromResponsible: current.responsible,
          toResponsible: body.responsible === undefined ? current.responsible : body.responsible,
          notes: body.notes,
        },
      });
      return tx.asset.update({
        where: { id },
        data: {
          poolId: body.poolId,
          folderId: body.folderId,
          location: body.location,
          responsible: body.responsible,
        },
      });
    });
    await audit(request, 'MOVE', 'Asset', id, current, updated);
    return updated;
  });
}
