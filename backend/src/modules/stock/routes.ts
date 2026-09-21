import type { FastifyInstance } from 'fastify';
import { PermissionCode, Prisma, StockMovementType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';
import { fail, assertPool, poolScope, requireAsset, writablePool, descendants } from '../../utils/access.js';
import { operation, serial } from '../../utils/transaction.js';
import { attachComponents, componentsSchema } from './service.js';
import { afterRemoval, stockTotals } from './domain.js';

const profileSchema = z.object({
  poolId: z.string().min(1), categoryId: z.string().min(1), name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  manufacturer: z.string().trim().max(200).optional().nullable(), model: z.string().trim().max(200).optional().nullable(),
  specifications: z.string().trim().max(8000).optional().nullable(),
});
const idSchema = z.object({ id: z.string().min(1) });
const requestId = z.string().uuid();

async function accessibleProfile(request: Parameters<typeof assertPool>[0], id: string, tx: Prisma.TransactionClient = prisma) {
  const profile = await tx.itemProfile.findFirst({ where: { id, ...poolScope(request) } });
  if (!profile) fail(404, 'Perfil de item não encontrado ou sem acesso.');
  return profile;
}

export async function stockRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);
  const write = { preHandler: app.requirePermission(PermissionCode.STOCK_MANAGE) };

  app.get('/catalog', async request => {
    const q = z.object({ poolId: z.string().optional() }).parse(request.query);
    const scope = poolScope(request, q.poolId);
    const [profiles, categories] = await prisma.$transaction(async tx => Promise.all([
      tx.itemProfile.findMany({ where: { ...scope, active: true }, include: {
        pool: { select: { id: true, name: true } }, category: true,
        components: { where: { removedAt: null, asset: scope }, select: { quantity: true } },
      }, orderBy: { name: 'asc' } }),
      tx.category.findMany({ orderBy: { name: 'asc' } }),
    ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const items = profiles.map(({ components, ...profile }) => ({ ...profile, ...stockTotals(profile.availableQty, components.reduce((n, c) => n + c.quantity, 0)) }));
    const tree = categories.map(c => {
      const ids = new Set(descendants(categories, c.id));
      const sub = items.filter(p => ids.has(p.categoryId));
      const available = sub.reduce((n, p) => n + p.available, 0);
      const installed = sub.reduce((n, p) => n + p.installed, 0);
      return { ...c, ...stockTotals(available, installed), profileCount: sub.length };
    });
    return { profiles: items, categories: tree,
      totals: stockTotals(items.reduce((n, p) => n + p.available, 0), items.reduce((n, p) => n + p.installed, 0)) };
  });

  app.post('/profiles', write, async (request, reply) => {
    const { initialAvailable, requestId: opId, ...data } = profileSchema.extend({
      initialAvailable: z.number().int().min(0).max(1000000).default(0), requestId,
    }).parse(request.body);
    const result = await operation(request, opId, 'CREATE_PROFILE', { data, initialAvailable }, async tx => { await writablePool(request, data.poolId, tx); }, async tx => {
      if (!await tx.category.findUnique({ where: { id: data.categoryId } })) fail(400, 'Categoria não encontrada.');
      const profile = await tx.itemProfile.create({ data: { ...data, availableQty: initialAvailable } });
      if (initialAvailable) await tx.stockMovement.create({ data: {
        profileId: profile.id, userId: request.user.sub, operationId: opId, type: StockMovementType.RECEIPT,
        quantity: initialAvailable, availableAfter: initialAvailable, notes: 'Saldo inicial disponível.',
      } });
      await audit(request, 'CREATE', 'ItemProfile', profile.id, undefined, profile, tx);
      return profile;
    });
    return reply.status(201).send(result);
  });

  app.put('/profiles/:id', write, async request => {
    const { id } = idSchema.parse(request.params);
    // Pool cannot be changed directly: doing so would move all installed components silently.
    const data = profileSchema.omit({ poolId: true }).partial().parse(request.body);
    return serial(async tx => {
      const before = await accessibleProfile(request, id, tx);
      await writablePool(request, before.poolId, tx);
      if (data.categoryId && !await tx.category.findUnique({ where: { id: data.categoryId } })) fail(400, 'Categoria não encontrada.');
      const after = await tx.itemProfile.update({ where: { id }, data });
      await audit(request, 'UPDATE', 'ItemProfile', id, before, after, tx);
      return after;
    });
  });

  app.delete('/profiles/:id', write, async request => {
    const { id } = idSchema.parse(request.params);
    return serial(async tx => {
      const profile = await accessibleProfile(request, id, tx);
      await writablePool(request, profile.poolId, tx);
      const installed = await tx.assetComponent.count({ where: { profileId: id, removedAt: null } });
      if (profile.availableQty || installed) fail(409, 'Esvazie o saldo disponível e os componentes instalados antes de arquivar o perfil.');
      await tx.itemProfile.update({ where: { id }, data: { active: false } });
      await audit(request, 'ARCHIVE', 'ItemProfile', id, profile, { active: false }, tx);
      return { message: 'Perfil arquivado; o histórico foi preservado.' };
    });
  });

  app.post('/profiles/:id/stock', write, async request => {
    const { id } = idSchema.parse(request.params);
    const body = z.object({ requestId, type: z.enum(['RECEIPT', 'WITHDRAWAL']), quantity: z.number().int().min(1).max(1000000), notes: z.string().trim().min(3).max(2000) }).parse(request.body);
    return operation(request, body.requestId, 'STOCK_CHANGE', { id, ...body }, async tx => {
      const p = await accessibleProfile(request, id, tx); await writablePool(request, p.poolId, tx);
    }, async tx => {
      const before = await accessibleProfile(request, id, tx);
      if (!before.active) fail(409, 'Perfil arquivado.');
      if (body.type === 'WITHDRAWAL' && before.availableQty < body.quantity) fail(409, 'Saldo disponível insuficiente.');
      const after = await tx.itemProfile.update({ where: { id }, data: { availableQty: { increment: body.type === 'RECEIPT' ? body.quantity : -body.quantity } } });
      await tx.stockMovement.create({ data: { profileId: id, userId: request.user.sub, operationId: body.requestId,
        type: body.type, quantity: body.quantity, availableAfter: after.availableQty, notes: body.notes } });
      await audit(request, body.type, 'ItemProfile', id, before, after, tx);
      return { message: 'Saldo atualizado.', available: after.availableQty };
    });
  });

  app.post('/assign', write, async request => {
    const body = z.object({ requestId, poolId: z.string().min(1), assetIds: z.array(z.string().min(1)).min(1).max(200), components: componentsSchema }).parse(request.body);
    if (!body.components.length) fail(400, 'Selecione ao menos um componente.');
    if (new Set(body.assetIds).size !== body.assetIds.length) fail(400, 'Ativos duplicados no lote.');
    return operation(request, body.requestId, 'ASSIGN', body, async tx => { await writablePool(request, body.poolId, tx); }, async tx => {
      const assets = await tx.asset.findMany({ where: { id: { in: body.assetIds }, poolId: body.poolId } });
      if (assets.length !== body.assetIds.length) fail(404, 'Um ou mais ativos não existem no Setor autorizado.');
      const componentIds = await attachComponents(tx, request, assets, body.components, body.requestId);
      return { message: 'Componentes associados.', assets: assets.length, componentIds };
    });
  });

  app.get('/assets/:id/components', async request => {
    const { id } = idSchema.parse(request.params);
    await requireAsset(request, id);
    return prisma.assetComponent.findMany({ where: { assetId: id, removedAt: null, profile: poolScope(request) }, include: { profile: { include: { category: true } } }, orderBy: { installedAt: 'asc' } });
  });

  app.post('/components/:id/remove', write, async request => {
    const { id } = idSchema.parse(request.params);
    const body = z.object({ requestId, quantity: z.number().int().min(1).max(1000000), disposition: z.enum(['RETURN_TO_STOCK', 'RETIRE_INSTALLED']), notes: z.string().trim().min(3).max(2000) }).parse(request.body);
    const authorize = async (tx: Prisma.TransactionClient) => {
      const c = await tx.assetComponent.findFirst({ where: { id, asset: poolScope(request), profile: poolScope(request) }, include: { profile: true } });
      if (!c) fail(404, 'Componente não encontrado ou sem acesso.');
      await writablePool(request, c.profile.poolId, tx);
    };
    return operation(request, body.requestId, 'REMOVE_COMPONENT', { id, ...body }, authorize, async tx => {
      const current = await tx.assetComponent.findUniqueOrThrow({ where: { id }, include: { profile: true } });
      if (current.removedAt || body.quantity > current.quantity) fail(409, 'Quantidade maior que a quantidade instalada ou componente já removido.');
      const next = afterRemoval(current.profile.availableQty, current.quantity, body.quantity, body.disposition);
      const full = body.quantity === current.quantity;
      await tx.assetComponent.update({ where: { id }, data: full ? { removedAt: new Date() } : { quantity: { decrement: body.quantity } } });
      const profile = await tx.itemProfile.update({ where: { id: current.profileId }, data: { availableQty: next.available } });
      await tx.stockMovement.create({ data: { profileId: profile.id, assetId: current.assetId, userId: request.user.sub, operationId: body.requestId,
        type: body.disposition, quantity: body.quantity, availableAfter: profile.availableQty, notes: body.notes } });
      await audit(request, body.disposition, 'AssetComponent', id, { quantity: current.quantity }, body, tx);
      return { message: body.disposition === 'RETURN_TO_STOCK' ? 'Componente devolvido ao disponível.' : 'Componente baixado do inventário.' };
    });
  });

  app.get('/movements', async request => {
    const q = z.object({ poolId: z.string().optional(), profileId: z.string().optional(), page: z.coerce.number().int().min(1).default(1) }).parse(request.query);
    const where: Prisma.StockMovementWhereInput = { profileId: q.profileId, profile: poolScope(request, q.poolId) };
    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({ where, include: { profile: { select: { name: true, pool: { select: { name: true } } } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * 50, take: 50 }),
      prisma.stockMovement.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: 50 };
  });
}
