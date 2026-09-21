import type { FastifyInstance } from 'fastify';
import { NonPatrimonialMovementType, PermissionCode, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';
import { fail, poolScope, writablePool } from '../../utils/access.js';
import { serial } from '../../utils/transaction.js';
import { nextNonPatrimonialCode } from './service.js';

const optionalText = z.string().trim().max(4000).optional().nullable();
const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: optionalText,
  manufacturer: optionalText,
  model: optionalText,
  quantity: z.coerce.number().int().min(0).max(1_000_000).default(0),
  location: optionalText,
  responsible: optionalText,
  poolId: z.string().min(1),
  categoryId: z.string().min(1),
});
const editSchema = createSchema.omit({ quantity: true, poolId: true }).partial().refine(
  value => Object.keys(value).length > 0,
  { message: 'Informe ao menos um campo para alterar.' },
);
const idSchema = z.object({ id: z.string().min(1) });
const itemInclude = { pool: true, category: true, _count: { select: { movements: true } } } as const;

async function requireItem(request: Parameters<typeof writablePool>[0], id: string, tx: Prisma.TransactionClient = prisma) {
  const item = await tx.nonPatrimonialItem.findFirst({ where: { id, ...poolScope(request) }, include: itemInclude });
  if (!item) fail(404, 'Item não patrimoniado não encontrado ou sem acesso.');
  return item;
}

async function requireCategory(tx: Prisma.TransactionClient, categoryId: string) {
  const category = await tx.category.findUnique({ where: { id: categoryId } });
  if (!category) fail(400, 'Categoria não encontrada.');
  return category;
}

export async function nonPatrimonialRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async request => {
    const query = z.object({
      search: z.string().trim().max(200).optional(),
      poolId: z.string().optional(),
      categoryId: z.string().optional(),
      active: z.enum(['true', 'false', 'all']).default('true'),
    }).parse(request.query);

    const where: Prisma.NonPatrimonialItemWhereInput = {
      ...poolScope(request, query.poolId),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.active === 'all' ? {} : { active: query.active === 'true' }),
      ...(query.search ? {
        OR: [
          { internalCode: { contains: query.search, mode: 'insensitive' } },
          { name: { contains: query.search, mode: 'insensitive' } },
          { manufacturer: { contains: query.search, mode: 'insensitive' } },
          { model: { contains: query.search, mode: 'insensitive' } },
          { location: { contains: query.search, mode: 'insensitive' } },
          { responsible: { contains: query.search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    return prisma.nonPatrimonialItem.findMany({
      where,
      include: itemInclude,
      orderBy: [{ active: 'desc' }, { name: 'asc' }, { internalCode: 'asc' }],
    });
  });

  app.get('/:id', async request => {
    const { id } = idSchema.parse(request.params);
    return requireItem(request, id);
  });

  app.get('/:id/movements', async request => {
    const { id } = idSchema.parse(request.params);
    await requireItem(request, id);
    return prisma.nonPatrimonialMovement.findMany({
      where: { itemId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });

  app.post('/', { preHandler: app.requirePermission(PermissionCode.NON_PATRIMONIAL_CREATE) }, async (request, reply) => {
    const data = createSchema.parse(request.body);
    const result = await serial(async tx => {
      await writablePool(request, data.poolId, tx);
      await requireCategory(tx, data.categoryId);
      const internalCode = await nextNonPatrimonialCode(tx);
      const item = await tx.nonPatrimonialItem.create({ data: { ...data, internalCode }, include: itemInclude });
      if (data.quantity > 0) {
        await tx.nonPatrimonialMovement.create({ data: {
          itemId: item.id,
          userId: request.user.sub,
          type: NonPatrimonialMovementType.INITIAL,
          quantity: data.quantity,
          quantityBefore: 0,
          quantityAfter: data.quantity,
          toPoolId: data.poolId,
          notes: 'Saldo inicial do cadastro.',
        } });
      }
      await audit(request, 'CREATE', 'NonPatrimonialItem', item.id, undefined, item, tx);
      return item;
    });
    return reply.status(201).send(result);
  });

  app.put('/:id', { preHandler: app.requirePermission(PermissionCode.NON_PATRIMONIAL_EDIT) }, async request => {
    const { id } = idSchema.parse(request.params);
    const data = editSchema.parse(request.body);
    return serial(async tx => {
      const before = await requireItem(request, id, tx);
      await writablePool(request, before.poolId, tx);
      if (data.categoryId) await requireCategory(tx, data.categoryId);
      const updated = await tx.nonPatrimonialItem.update({ where: { id }, data, include: itemInclude });
      await audit(request, 'UPDATE', 'NonPatrimonialItem', id, before, updated, tx);
      return updated;
    });
  });

  app.post('/:id/stock', { preHandler: app.requirePermission(PermissionCode.NON_PATRIMONIAL_MOVE) }, async request => {
    const { id } = idSchema.parse(request.params);
    const body = z.object({
      type: z.enum(['ENTRY', 'EXIT', 'ADJUSTMENT']),
      quantity: z.coerce.number().int().min(0).max(1_000_000),
      notes: z.string().trim().min(3).max(2000),
    }).parse(request.body);

    return serial(async tx => {
      const before = await requireItem(request, id, tx);
      await writablePool(request, before.poolId, tx);
      if (!before.active) fail(409, 'Reative o item antes de movimentar o saldo.');

      let quantityAfter = before.quantity;
      let movementQuantity = body.quantity;
      let type: NonPatrimonialMovementType;
      if (body.type === 'ENTRY') {
        if (body.quantity < 1) fail(400, 'Informe uma quantidade maior que zero.');
        quantityAfter = before.quantity + body.quantity;
        type = NonPatrimonialMovementType.ENTRY;
      } else if (body.type === 'EXIT') {
        if (body.quantity < 1) fail(400, 'Informe uma quantidade maior que zero.');
        if (body.quantity > before.quantity) fail(409, 'Quantidade maior que o saldo atual.');
        quantityAfter = before.quantity - body.quantity;
        type = NonPatrimonialMovementType.EXIT;
      } else {
        quantityAfter = body.quantity;
        if (quantityAfter === before.quantity) fail(400, 'O novo saldo é igual ao saldo atual.');
        movementQuantity = Math.abs(quantityAfter - before.quantity);
        type = NonPatrimonialMovementType.ADJUSTMENT;
      }

      const item = await tx.nonPatrimonialItem.update({ where: { id }, data: { quantity: quantityAfter }, include: itemInclude });
      await tx.nonPatrimonialMovement.create({ data: {
        itemId: id,
        userId: request.user.sub,
        type,
        quantity: movementQuantity,
        quantityBefore: before.quantity,
        quantityAfter,
        fromPoolId: before.poolId,
        toPoolId: before.poolId,
        notes: body.notes,
      } });
      await audit(request, 'STOCK', 'NonPatrimonialItem', id, { quantity: before.quantity }, { quantity: quantityAfter, type: body.type, notes: body.notes }, tx);
      return item;
    });
  });

  app.post('/:id/transfer', { preHandler: app.requirePermission(PermissionCode.NON_PATRIMONIAL_MOVE) }, async request => {
    const { id } = idSchema.parse(request.params);
    const body = z.object({
      toPoolId: z.string().min(1),
      quantity: z.coerce.number().int().min(1).max(1_000_000),
      notes: z.string().trim().min(3).max(2000),
    }).parse(request.body);

    return serial(async tx => {
      const source = await requireItem(request, id, tx);
      await writablePool(request, source.poolId, tx);
      await writablePool(request, body.toPoolId, tx);
      if (!source.active) fail(409, 'Reative o item antes de transferi-lo.');
      if (source.poolId === body.toPoolId) fail(400, 'Selecione um Setor de destino diferente.');
      if (body.quantity > source.quantity) fail(409, 'Quantidade maior que o saldo atual.');

      const sourceAfter = source.quantity - body.quantity;
      await tx.nonPatrimonialItem.update({ where: { id }, data: { quantity: sourceAfter } });

      let destination = await tx.nonPatrimonialItem.findFirst({
        where: { lineageId: source.lineageId, poolId: body.toPoolId, active: true },
      });
      const destinationBefore = destination?.quantity ?? 0;
      if (destination) {
        destination = await tx.nonPatrimonialItem.update({
          where: { id: destination.id },
          data: { quantity: { increment: body.quantity } },
        });
      } else {
        destination = await tx.nonPatrimonialItem.create({ data: {
          internalCode: await nextNonPatrimonialCode(tx),
          lineageId: source.lineageId,
          name: source.name,
          description: source.description,
          manufacturer: source.manufacturer,
          model: source.model,
          quantity: body.quantity,
          location: source.location,
          responsible: source.responsible,
          poolId: body.toPoolId,
          categoryId: source.categoryId,
        } });
      }

      await tx.nonPatrimonialMovement.createMany({ data: [
        {
          itemId: source.id, userId: request.user.sub, type: NonPatrimonialMovementType.TRANSFER_OUT,
          quantity: body.quantity, quantityBefore: source.quantity, quantityAfter: sourceAfter,
          fromPoolId: source.poolId, toPoolId: body.toPoolId, counterpartItemId: destination.id, notes: body.notes,
        },
        {
          itemId: destination.id, userId: request.user.sub, type: NonPatrimonialMovementType.TRANSFER_IN,
          quantity: body.quantity, quantityBefore: destinationBefore, quantityAfter: destination.quantity,
          fromPoolId: source.poolId, toPoolId: body.toPoolId, counterpartItemId: source.id, notes: body.notes,
        },
      ] });

      await audit(request, 'TRANSFER', 'NonPatrimonialItem', source.id, { poolId: source.poolId, quantity: source.quantity }, {
        toPoolId: body.toPoolId, quantity: body.quantity, sourceAfter, destinationItemId: destination.id,
      }, tx);

      return {
        message: 'Transferência registrada.',
        source: await tx.nonPatrimonialItem.findUniqueOrThrow({ where: { id: source.id }, include: itemInclude }),
        destination: await tx.nonPatrimonialItem.findUniqueOrThrow({ where: { id: destination.id }, include: itemInclude }),
      };
    });
  });

  app.delete('/:id', { preHandler: app.requirePermission(PermissionCode.NON_PATRIMONIAL_ARCHIVE) }, async request => {
    const { id } = idSchema.parse(request.params);
    return serial(async tx => {
      const before = await requireItem(request, id, tx);
      await writablePool(request, before.poolId, tx);
      if (!before.active) return { message: 'Item já estava arquivado.' };
      if (before.quantity > 0) fail(409, `Zere ou transfira as ${before.quantity} unidade(s) antes de arquivar.`);
      const updated = await tx.nonPatrimonialItem.update({ where: { id }, data: { active: false } });
      await audit(request, 'ARCHIVE', 'NonPatrimonialItem', id, before, updated, tx);
      return { message: 'Item arquivado. O histórico foi preservado.' };
    });
  });

  app.post('/:id/reactivate', { preHandler: app.requirePermission(PermissionCode.NON_PATRIMONIAL_EDIT) }, async request => {
    const { id } = idSchema.parse(request.params);
    return serial(async tx => {
      const before = await requireItem(request, id, tx);
      await writablePool(request, before.poolId, tx);
      const updated = await tx.nonPatrimonialItem.update({ where: { id }, data: { active: true }, include: itemInclude });
      await audit(request, 'REACTIVATE', 'NonPatrimonialItem', id, before, updated, tx);
      return updated;
    });
  });
}
