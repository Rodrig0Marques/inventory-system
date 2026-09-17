import type { FastifyInstance } from 'fastify';
import { AssetStatus, Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';
import { fail, poolScope, requireAsset, writablePool, validateAssetLinks } from '../../utils/access.js';
import { serial, operation } from '../../utils/transaction.js';
import { attachComponents, componentsSchema, ensureFolderPath } from '../stock/service.js';

const optionalText = z.string().trim().max(4000).optional().nullable();
const assetSchema = z.object({
  patrimonyNumber: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(200),
  description: optionalText, serialNumber: optionalText, manufacturer: optionalText, model: optionalText,
  purchasePrice: z.coerce.number().finite().nonnegative().max(999999999999.99).optional().nullable(),
  purchaseDate: z.string().datetime().optional().nullable(), status: z.nativeEnum(AssetStatus).optional(),
  location: optionalText, responsible: optionalText, poolId: z.string().min(1), categoryId: z.string().min(1),
  folderId: z.string().min(1).optional().nullable(), assetTypeId: z.string().min(1).optional().nullable(), customValues: z.record(z.any()).optional(),
});
const idSchema = z.object({ id: z.string().min(1) });
const include = { pool: true, folder: true, category: true, assetType: true, customValues: { include: { customField: true } } } as const;

async function saveCustom(tx: Prisma.TransactionClient, id: string, categoryId: string, values?: Record<string, any>) {
  if (!values) return;
  const fields = await tx.customField.findMany({ where: { categoryId } });
  for (const field of fields) if (values[field.key] !== undefined) await tx.assetCustomValue.upsert({
    where: { assetId_customFieldId: { assetId: id, customFieldId: field.id } },
    update: { value: values[field.key] }, create: { assetId: id, customFieldId: field.id, value: values[field.key] },
  });
}

export async function assetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);
  const write = { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) };

  app.get('/summary', async request => {
    // Os quatro indicadores principais do Dashboard podem ser globais para
    // usuários explicitamente autorizados. Detalhes por Pool continuam escopados.
    const scopedWhere: Prisma.AssetWhereInput = poolScope(request);
    const dashboardWhere: Prisma.AssetWhereInput = request.canGlobalDashboardStats ? {} : scopedWhere;

    const totalQuery = prisma.asset.count({ where: dashboardWhere });

    // Separe a consulta para evitar erro de inferência no $transaction.
    // Sem await aqui: a execução permanece dentro da transação abaixo.
    const byStatusQuery = prisma.asset.groupBy({
      by: ['status'],
      where: dashboardWhere,
      orderBy: { status: 'asc' },
      _count: { _all: true },
    });

    const valueQuery = prisma.asset.aggregate({
      where: dashboardWhere,
      _sum: { purchasePrice: true },
    });

    const [total, byStatus, value] = await prisma.$transaction([
      totalQuery,
      byStatusQuery,
      valueQuery,
    ]);

    return {
      total,
      byStatus,
      totalValue: value._sum.purchasePrice ?? 0,
      countsAreGlobal: request.canGlobalDashboardStats,
    };
  });

  app.get('/', async request => {
    const q = z.object({ search: z.string().optional(), poolId: z.string().optional(), categoryId: z.string().optional(), folderId: z.string().optional(),
      status: z.nativeEnum(AssetStatus).optional(), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(request.query);
    const where: Prisma.AssetWhereInput = { ...poolScope(request, q.poolId), categoryId: q.categoryId, folderId: q.folderId, status: q.status,
      ...(q.search ? { OR: ['patrimonyNumber', 'name', 'serialNumber', 'manufacturer', 'model', 'description', 'location', 'responsible'].map(field => ({ [field]: { contains: q.search, mode: 'insensitive' } })) } : {}) };
    const [items, total] = await Promise.all([
      prisma.asset.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.asset.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.get('/global-lookup', async request => {
    if (!request.canGlobalAssetLookup) fail(403, 'Você não possui permissão para consultar patrimônios fora dos seus Pools.');

    const { patrimony } = z.object({
      patrimony: z.string().trim().min(1, 'Informe o patrimônio.').max(100),
    }).parse(request.query);

    // Busca propositalmente exata: permite localizar um patrimônio em qualquer Pool
    // sem transformar a permissão em uma listagem global do inventário.
    const items = await prisma.asset.findMany({
      where: { patrimonyNumber: { equals: patrimony, mode: 'insensitive' } },
      select: {
        id: true, patrimonyNumber: true, name: true, description: true, status: true,
        manufacturer: true, model: true, location: true, responsible: true,
        pool: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        folder: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    await audit(request, 'GLOBAL_ASSET_LOOKUP', 'Asset', undefined, undefined, { patrimony, resultCount: items.length });
    return { items };
  });

  app.get('/:id', async request => {
    const { id } = idSchema.parse(request.params);
    await requireAsset(request, id);
    const asset = await prisma.asset.findFirst({ where: { id, ...poolScope(request) }, include: { ...include, movements: { orderBy: { createdAt: 'desc' } } } });
    if (!asset) fail(404, 'Ativo não encontrado ou sem acesso.');
    // A transfer must not disclose history from a pool the current user cannot see.
    return { ...asset, movements: request.poolIds === null ? asset.movements : asset.movements.filter(m =>
      (!m.fromPoolId || request.poolIds!.includes(m.fromPoolId)) && (!m.toPoolId || request.poolIds!.includes(m.toPoolId))) };
  });

  app.post('/', write, async (request, reply) => {
    const data = assetSchema.parse(request.body);
    const { customValues, purchaseDate, purchasePrice, ...base } = data;
    const asset = await serial(async tx => {
      await writablePool(request, data.poolId, tx); await validateAssetLinks(tx, data);
      const created = await tx.asset.create({ data: { ...base, purchasePrice: purchasePrice == null ? null : new Prisma.Decimal(purchasePrice), purchaseDate: purchaseDate ? new Date(purchaseDate) : null } });
      await saveCustom(tx, created.id, created.categoryId, customValues);
      await audit(request, 'CREATE', 'Asset', created.id, undefined, created, tx);
      return created;
    });
    return reply.status(201).send(asset);
  });

  app.post('/batch', write, async (request, reply) => {
    const body = z.object({
      requestId: z.string().uuid(), poolId: z.string().min(1), categoryId: z.string().min(1),
      manufacturer: optionalText, model: optionalText, location: optionalText, responsible: optionalText,
      description: optionalText, folderPrefix: z.string().trim().max(1000).optional(),
      assets: z.array(z.object({ patrimonyNumber: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(200), folderPath: z.string().trim().max(1000).optional() })).min(1).max(200),
      components: componentsSchema.default([]),
    }).parse(request.body);
    const codes = body.assets.map(a => a.patrimonyNumber.toLocaleLowerCase());
    if (new Set(codes).size !== codes.length) fail(400, 'O lote possui patrimônios repetidos.');
    const result = await operation(request, body.requestId, 'CREATE_ASSET_BATCH', body, async tx => { await writablePool(request, body.poolId, tx); }, async tx => {
      await validateAssetLinks(tx, body);
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`folders:${body.poolId}`}))`;
      const assets: Array<Awaited<ReturnType<typeof tx.asset.create>>> = [];
      for (const row of body.assets) {
        if (await tx.asset.findUnique({ where: { poolId_patrimonyNumber: { poolId: body.poolId, patrimonyNumber: row.patrimonyNumber } } })) fail(409, `O patrimônio ${row.patrimonyNumber} já existe. Nenhum item deste lote foi gravado.`);
        const path = [body.folderPrefix, row.folderPath].filter(Boolean).join('/');
        const folderId = await ensureFolderPath(tx, body.poolId, path);
        const asset = await tx.asset.create({ data: {
          patrimonyNumber: row.patrimonyNumber, name: row.name, poolId: body.poolId, categoryId: body.categoryId, folderId,
          description: body.description, manufacturer: body.manufacturer, model: body.model, location: body.location, responsible: body.responsible,
        } });
        assets.push(asset);
      }
      if (body.components.length) await attachComponents(tx, request, assets, body.components, body.requestId);
      await audit(request, 'CREATE_BATCH', 'Asset', body.requestId, undefined, { poolId: body.poolId, assetIds: assets.map(a => a.id), quantity: assets.length }, tx);
      return { message: `${assets.length} ativo(s) cadastrado(s) com suas pastas e componentes.`, total: assets.length, assets: assets.map(a => ({ id: a.id, patrimonyNumber: a.patrimonyNumber })) };
    });
    return reply.status(201).send(result);
  });

  async function update(request: Parameters<typeof requireAsset>[0], id: string, data: Partial<z.infer<typeof assetSchema>>, notes?: string) {
    return serial(async tx => {
      const previous = await requireAsset(request, id, tx);
      await writablePool(request, previous.poolId, tx);
      const targetPool = data.poolId ?? previous.poolId;
      await writablePool(request, targetPool, tx);
      const changesPool = targetPool !== previous.poolId;
      const effective = { ...previous, ...data, poolId: targetPool,
        folderId: changesPool && data.folderId === undefined ? null : data.folderId === undefined ? previous.folderId : data.folderId,
        assetTypeId: data.categoryId && data.categoryId !== previous.categoryId && data.assetTypeId === undefined ? null : data.assetTypeId === undefined ? previous.assetTypeId : data.assetTypeId };
      await validateAssetLinks(tx, effective);
      if (changesPool || (data.status && ['DISPOSED', 'SOLD', 'LOST', 'INACTIVE'].includes(data.status))) {
        if (await tx.assetComponent.count({ where: { assetId: id, removedAt: null } })) fail(409, 'Resolva os componentes instalados (devolução ou baixa) antes de transferir o Pool ou baixar/inativar o equipamento.');
      }
      const { customValues, purchasePrice, purchaseDate, ...base } = data;
      const updated = await tx.asset.update({ where: { id }, data: { ...base, folderId: effective.folderId, assetTypeId: effective.assetTypeId,
        ...(purchasePrice !== undefined ? { purchasePrice: purchasePrice == null ? null : new Prisma.Decimal(purchasePrice) } : {}),
        ...(purchaseDate !== undefined ? { purchaseDate: purchaseDate ? new Date(purchaseDate) : null } : {}) } });
      if (updated.categoryId !== previous.categoryId) await tx.assetCustomValue.deleteMany({ where: { assetId: id } });
      await saveCustom(tx, id, updated.categoryId, customValues);
      if (changesPool || data.folderId !== undefined || data.location !== undefined || data.responsible !== undefined) await tx.assetMovement.create({ data: {
        assetId: id, fromPoolId: previous.poolId, toPoolId: updated.poolId, fromFolderId: previous.folderId, toFolderId: updated.folderId,
        fromLocation: previous.location, toLocation: updated.location, fromResponsible: previous.responsible, toResponsible: updated.responsible, notes,
      } });
      await audit(request, 'UPDATE', 'Asset', id, previous, updated, tx);
      return updated;
    });
  }

  app.put('/:id', write, async request => update(request, idSchema.parse(request.params).id, assetSchema.partial().parse(request.body)));
  app.post('/:id/move', write, async request => {
    const body = z.object({ poolId: z.string().optional(), folderId: z.string().optional().nullable(), location: optionalText, responsible: optionalText, notes: optionalText }).parse(request.body);
    const { notes, ...data } = body;
    return update(request, idSchema.parse(request.params).id, data, notes ?? undefined);
  });
  app.delete('/:id', write, async request => {
    const { id } = idSchema.parse(request.params);
    return serial(async tx => {
      const previous = await requireAsset(request, id, tx); await writablePool(request, previous.poolId, tx);
      if (await tx.assetComponent.count({ where: { assetId: id, removedAt: null } })) fail(409, 'O ativo possui componentes instalados. Devolva ou dê baixa nos componentes antes de excluir.');
      await tx.assetComponent.deleteMany({ where: { assetId: id, removedAt: { not: null } } });
      await tx.asset.delete({ where: { id } });
      await audit(request, 'DELETE', 'Asset', id, previous, undefined, tx);
      return { message: 'Ativo excluído; o histórico de estoque foi preservado.' };
    });
  });
}
