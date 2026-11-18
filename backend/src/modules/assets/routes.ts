import type { FastifyInstance } from 'fastify';
import { AssetStatus, PermissionCode, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';
import { fail, poolScope, requireAsset, writablePool, validateAssetLinks, descendants } from '../../utils/access.js';
import { serial, operation } from '../../utils/transaction.js';
import { hasPermission } from '../../utils/permissions.js';
import { attachComponents, componentsSchema, ensureFolderPath } from '../stock/service.js';
import { validateCustomValues } from './custom-fields.js';
import { transferInstalledComponents } from './transfer.js';

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

async function saveCustom(tx: Prisma.TransactionClient, id: string, categoryId: string, values: Record<string, unknown> = {}) {
  const fields = await tx.customField.findMany({ where: { categoryId } });
  const retained = await tx.assetCustomValue.findMany({ where: { assetId: id }, include: { customField: true } });
  const effective = Object.fromEntries(retained.filter(item => item.customField.categoryId === categoryId).map(item => [item.customField.key, item.value]));
  validateCustomValues(fields, { ...effective, ...values });
  for (const field of fields) if (values[field.key] !== undefined) await tx.assetCustomValue.upsert({
    where: { assetId_customFieldId: { assetId: id, customFieldId: field.id } },
    update: { value: values[field.key] === null ? Prisma.JsonNull : values[field.key] as Prisma.InputJsonValue }, create: { assetId: id, customFieldId: field.id, value: values[field.key] === null ? Prisma.JsonNull : values[field.key] as Prisma.InputJsonValue },
  });
}

export async function assetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);
  const createPermission = { preHandler: app.requirePermission(PermissionCode.ASSET_CREATE) };
  const editPermission = { preHandler: app.requirePermission(PermissionCode.ASSET_EDIT) };
  const deletePermission = { preHandler: app.requirePermission(PermissionCode.ASSET_DELETE) };
  const movePermission = { preHandler: app.requirePermission(PermissionCode.ASSET_MOVE) };

  app.get('/summary', async request => {
    // Os quatro indicadores principais do Dashboard podem ser globais para
    // usuários explicitamente autorizados. Detalhes por Pool continuam escopados.
    const scopedWhere: Prisma.AssetWhereInput = poolScope(request);
    const dashboardWhere: Prisma.AssetWhereInput = { ...(request.canGlobalDashboardStats ? {} : scopedWhere), archivedAt: null };

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
      scope: request.canGlobalDashboardStats ? 'GLOBAL' : 'ASSIGNED_POOLS',
    };
  });

  app.get('/', async request => {
    const q = z.object({ search: z.string().optional(), poolId: z.string().optional(), categoryId: z.string().optional(), folderId: z.string().optional(),
      includeDescendants: z.enum(['true', 'false']).default('true'), archived: z.enum(['true', 'false', 'all']).default('false'),
      status: z.nativeEnum(AssetStatus).optional(), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(request.query);
    const categoryIds = q.categoryId && q.includeDescendants === 'true' ? descendants(await prisma.category.findMany({ select: { id: true, parentId: true } }), q.categoryId) : undefined;
    const where: Prisma.AssetWhereInput = { ...poolScope(request, q.poolId), archivedAt: q.archived === 'all' ? undefined : q.archived === 'true' ? { not: null } : null, categoryId: categoryIds ? { in: categoryIds } : q.categoryId, folderId: q.folderId, status: q.status,
      ...(q.search ? { OR: ['patrimonyNumber', 'name', 'serialNumber', 'manufacturer', 'model', 'description', 'location', 'responsible'].map(field => ({ [field]: { contains: q.search, mode: 'insensitive' } })) } : {}) };
    const [items, total] = await Promise.all([
      prisma.asset.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.asset.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.get('/global-lookup', async request => {
    if (!request.canGlobalAssetLookup) fail(403, 'Você não possui permissão para consultar patrimônios fora dos seus Setores.');

    const { patrimony, poolId, page, pageSize } = z.object({
      patrimony: z.string().trim().min(1, 'Informe pelo menos um patrimônio.').max(5000),
      poolId: z.string().min(1).optional(), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query);

    const uniquePatrimonies = new Map<string, string>();
    for (const value of patrimony.split(/[\n\r,;]+/)) {
      const trimmed = value.trim();
      if (trimmed) uniquePatrimonies.set(trimmed.toLocaleLowerCase(), trimmed);
    }
    const patrimonies = [...uniquePatrimonies.values()];

    if (!patrimonies.length) fail(400, 'Informe pelo menos um patrimônio.');
    if (patrimonies.length > 50) fail(400, 'É permitido consultar no máximo 50 patrimônios por vez.');

    // Busca propositalmente exata: permite localizar códigos conhecidos em qualquer Pool
    // sem transformar a permissão em uma listagem global do inventário.
    const where: Prisma.AssetWhereInput = {
        poolId, archivedAt: null,
        OR: patrimonies.map(value => ({ patrimonyNumber: { equals: value, mode: 'insensitive' } })),
    };
    const matchesQuery = prisma.asset.groupBy({ by: ['patrimonyNumber'], orderBy: { patrimonyNumber: 'asc' }, where, _count: { _all: true } });
    const [items, total, matches] = await prisma.$transaction([
      prisma.asset.findMany({
      where,
      select: {
        id: true, patrimonyNumber: true, name: true, description: true, status: true,
        manufacturer: true, model: true, location: true, responsible: true,
        pool: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        folder: { select: { id: true, name: true } },
      },
      orderBy: [{ patrimonyNumber: 'asc' }, { poolId: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize, take: pageSize,
    }), prisma.asset.count({ where }), matchesQuery,
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const found = new Set(matches.map(item => item.patrimonyNumber.toLocaleLowerCase()));
    const notFound = patrimonies.filter(value => !found.has(value.toLocaleLowerCase()));
    const counts = new Map<string, number>();
    for (const match of matches) { const key = match.patrimonyNumber.toLocaleLowerCase(); counts.set(key, (counts.get(key) || 0) + match._count._all); }
    const ambiguous = patrimonies.filter(code => (counts.get(code.toLocaleLowerCase()) || 0) > 1);

    await audit(request, 'GLOBAL_ASSET_LOOKUP', 'Asset', undefined, undefined, {
      patrimonies,
      requestedCount: patrimonies.length,
      resultCount: items.length,
      notFound,
    });

    return { items, requestedCount: patrimonies.length, resultCount: items.length, total, page, pageSize, hasMore: page * pageSize < total, notFound, ambiguous, identity: 'POOL_AND_PATRIMONY' };
  });

  app.get('/:id', async request => {
    const { id } = idSchema.parse(request.params);
    await requireAsset(request, id);
    const asset = await prisma.asset.findFirst({ where: { id, ...poolScope(request) }, include: { ...include, movements: { orderBy: { createdAt: 'desc' } } } });
    if (!asset) fail(404, 'Ativo não encontrado ou sem acesso.');
    // A transfer must not disclose history from a pool the current user cannot see.
    const movements = request.poolIds === null ? asset.movements : asset.movements.filter(m =>
      (!m.fromPoolId || request.poolIds!.includes(m.fromPoolId)) && (!m.toPoolId || request.poolIds!.includes(m.toPoolId)));
    const poolIds = [...new Set(movements.flatMap(m => [m.fromPoolId, m.toPoolId].filter((value): value is string => Boolean(value))))];
    const pools = await prisma.pool.findMany({ where: { id: { in: poolIds } }, select: { id: true, name: true } });
    const names = new Map(pools.map(pool => [pool.id, pool.name]));
    return { ...asset, movements: movements.map(m => ({ ...m, fromPoolName: m.fromPoolId ? names.get(m.fromPoolId) || 'Setor removido' : null, toPoolName: m.toPoolId ? names.get(m.toPoolId) || 'Setor removido' : null })) };
  });

  app.post('/', createPermission, async (request, reply) => {
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

  app.post('/batch', createPermission, async (request, reply) => {
    const body = z.object({
      requestId: z.string().uuid(), poolId: z.string().min(1), categoryId: z.string().min(1),
      manufacturer: optionalText, model: optionalText, location: optionalText, responsible: optionalText,
      description: optionalText, folderPrefix: z.string().trim().max(1000).optional(),
      assets: z.array(z.object({ patrimonyNumber: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(200), folderPath: z.string().trim().max(1000).optional() })).min(1).max(200),
      components: componentsSchema.default([]),
    }).parse(request.body);
    if (body.components.length && !hasPermission(request, PermissionCode.STOCK_MANAGE)) {
      fail(403, 'Você não possui permissão para movimentar estoque ou associar componentes.');
    }
    if ((body.folderPrefix || body.assets.some(asset => asset.folderPath)) && !hasPermission(request, PermissionCode.FOLDER_CREATE)) {
      fail(403, 'Você não possui permissão para criar ou reutilizar caminhos de pastas no cadastro em lote.');
    }
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
        await saveCustom(tx, asset.id, asset.categoryId);
        assets.push(asset);
      }
      if (body.components.length) await attachComponents(tx, request, assets, body.components, body.requestId);
      await audit(request, 'CREATE_BATCH', 'Asset', body.requestId, undefined, { poolId: body.poolId, assetIds: assets.map(a => a.id), quantity: assets.length }, tx);
      return { message: `${assets.length} ativo(s) cadastrado(s) com suas pastas e componentes.`, total: assets.length, assets: assets.map(a => ({ id: a.id, patrimonyNumber: a.patrimonyNumber })) };
    });
    return reply.status(201).send(result);
  });

  async function update(request: Parameters<typeof requireAsset>[0], id: string, data: Partial<z.infer<typeof assetSchema>>, notes?: string, transfer?: { requestId: string; transferComponents: boolean }) {
    const work = async (tx: Prisma.TransactionClient) => {
      const previous = await requireAsset(request, id, tx);
      if (previous.archivedAt) fail(409, 'Reative o ativo antes de alterar seu cadastro.');
      await writablePool(request, previous.poolId, tx);
      const targetPool = data.poolId ?? previous.poolId;
      await writablePool(request, targetPool, tx);
      const changesPool = targetPool !== previous.poolId;
      if (changesPool && !hasPermission(request, PermissionCode.ASSET_MOVE)) fail(403, 'Você não possui permissão para movimentar ativos entre Setores.');
      const effective = { ...previous, ...data, poolId: targetPool,
        folderId: changesPool && data.folderId === undefined ? null : data.folderId === undefined ? previous.folderId : data.folderId,
        assetTypeId: data.categoryId && data.categoryId !== previous.categoryId && data.assetTypeId === undefined ? null : data.assetTypeId === undefined ? previous.assetTypeId : data.assetTypeId };
      await validateAssetLinks(tx, effective);
      if (changesPool && transfer?.transferComponents) {
        if (!hasPermission(request, PermissionCode.STOCK_MANAGE)) fail(403, 'Você não possui permissão para transferir os componentes.');
        if (data.status && ['DISPOSED', 'SOLD', 'LOST', 'INACTIVE'].includes(data.status)) fail(409, 'A transferência com componentes não pode baixar ou inativar o ativo.');
        await transferInstalledComponents(tx, request, id, previous.poolId, targetPool, transfer.requestId);
      } else if (changesPool || (data.status && ['DISPOSED', 'SOLD', 'LOST', 'INACTIVE'].includes(data.status))) {
        if (await tx.assetComponent.count({ where: { assetId: id, removedAt: null } })) fail(409, 'Resolva os componentes instalados (devolução ou baixa) antes de transferir o Setor ou baixar/inativar o equipamento.');
      }
      const { customValues, purchasePrice, purchaseDate, ...base } = data;
      const updated = await tx.asset.update({ where: { id }, data: { ...base, folderId: effective.folderId, assetTypeId: effective.assetTypeId,
        ...(purchasePrice !== undefined ? { purchasePrice: purchasePrice == null ? null : new Prisma.Decimal(purchasePrice) } : {}),
        ...(purchaseDate !== undefined ? { purchaseDate: purchaseDate ? new Date(purchaseDate) : null } : {}) } });
      if (updated.categoryId !== previous.categoryId) await tx.assetCustomValue.deleteMany({ where: { assetId: id } });
      await saveCustom(tx, id, updated.categoryId, customValues);
      if (changesPool || updated.folderId !== previous.folderId || updated.location !== previous.location || updated.responsible !== previous.responsible) await tx.assetMovement.create({ data: {
        assetId: id, fromPoolId: previous.poolId, toPoolId: updated.poolId, fromFolderId: previous.folderId, toFolderId: updated.folderId,
        fromLocation: previous.location, toLocation: updated.location, fromResponsible: previous.responsible, toResponsible: updated.responsible, notes: notes || (changesPool ? transfer?.transferComponents ? 'Transferência do ativo com componentes.' : 'Transferência entre Setores.' : undefined),
      } });
      await audit(request, 'UPDATE', 'Asset', id, previous, updated, tx);
      return updated;
    };
    if (transfer?.transferComponents) return operation(request, transfer.requestId, 'TRANSFER_ASSET', { id, data, notes, transferComponents: true }, async tx => {
      const current = await requireAsset(request, id, tx);
      await writablePool(request, current.poolId, tx);
      if (data.poolId) await writablePool(request, data.poolId, tx);
      if (!hasPermission(request, PermissionCode.ASSET_MOVE) || !hasPermission(request, PermissionCode.STOCK_MANAGE)) fail(403, 'A transferência completa exige permissões para movimentar ativos e estoque.');
    }, work);
    return serial(work);
  }

  app.put('/:id', editPermission, async request => {
    const { requestId, transferComponents, ...data } = assetSchema.partial().extend({ requestId: z.string().uuid().optional(), transferComponents: z.boolean().default(false) }).parse(request.body);
    if (transferComponents && !requestId) fail(400, 'Informe requestId para transferir o ativo com componentes.');
    return update(request, idSchema.parse(request.params).id, data, undefined, transferComponents ? { requestId: requestId!, transferComponents } : undefined);
  });
  app.post('/:id/move', movePermission, async request => {
    const body = z.object({ requestId: z.string().uuid().optional(), transferComponents: z.boolean().default(false), poolId: z.string().optional(), folderId: z.string().optional().nullable(), location: optionalText, responsible: optionalText, notes: optionalText }).parse(request.body);
    const { notes, requestId, transferComponents, ...data } = body;
    if (transferComponents && !requestId) fail(400, 'Informe requestId para transferir o ativo com componentes.');
    return update(request, idSchema.parse(request.params).id, data, notes ?? undefined, transferComponents ? { requestId: requestId!, transferComponents } : undefined);
  });
  app.delete('/:id', deletePermission, async request => {
    const { id } = idSchema.parse(request.params);
    return serial(async tx => {
      const previous = await requireAsset(request, id, tx); await writablePool(request, previous.poolId, tx);
      if (await tx.assetComponent.count({ where: { assetId: id, removedAt: null } })) fail(409, 'O ativo possui componentes instalados. Devolva ou dê baixa nos componentes antes de arquivar.');
      if (!previous.archivedAt) {
        const updated = await tx.asset.update({ where: { id }, data: { archivedAt: new Date() } });
        await audit(request, 'ARCHIVE', 'Asset', id, previous, updated, tx);
      }
      return { message: 'Ativo arquivado; cadastro e histórico preservados.' };
    });
  });
  app.post('/:id/reactivate', deletePermission, async request => {
    const { id } = idSchema.parse(request.params);
    return serial(async tx => {
      const previous = await requireAsset(request, id, tx); await writablePool(request, previous.poolId, tx);
      const updated = await tx.asset.update({ where: { id }, data: { archivedAt: null } });
      if (previous.archivedAt) await audit(request, 'REACTIVATE', 'Asset', id, previous, updated, tx);
      return updated;
    });
  });
}
