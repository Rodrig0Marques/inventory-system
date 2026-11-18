import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { ImportKind, NonPatrimonialMovementType, PermissionCode, Prisma } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { prisma } from '../../plugins/prisma.js';
import { poolWhere, poolScope, writablePool, fail } from '../../utils/access.js';
import { operation } from '../../utils/transaction.js';
import { audit } from '../../utils/audit.js';
import { nextNonPatrimonialCode } from '../non-patrimonial/service.js';
import { validateCustomValues } from '../assets/custom-fields.js';
import { readImportErrors, rejectedRowsCsv, type ImportError } from './reports.js';

const importModeSchema = z.enum(['CREATE', 'UPDATE', 'SET_BALANCE']);
type ImportMode = z.infer<typeof importModeSchema>;

type RawRow = Record<string, unknown>;

type NormalizedRow = {
  patrimonyNumber: string;
  name: string;
  poolName: string;
  categoryName: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  purchasePrice?: number;
  priceWasProvided: boolean;
  priceIsValid: boolean;
  location?: string;
  responsible?: string;
};

type ResolvedRow = NormalizedRow & {
  row: number;
  poolId?: string;
  categoryId?: string;
  poolResolvedName?: string;
  categoryResolvedName?: string;
  errors: string[];
  action?: 'CREATE' | 'UPDATE';
  existingItemId?: string;
  version?: string;
};

function normalizeKey(key: string) {
  return key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeReference(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parsePrice(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { value: undefined, provided: false, valid: true };
  }

  if (typeof value === 'number') {
    return { value, provided: true, valid: Number.isFinite(value) && value >= 0 };
  }

  let raw = String(value).replace(/R\$/gi, '').replace(/\s/g, '');
  if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/\./g, '').replace(',', '.');
  else if (raw.includes(',')) raw = raw.replace(',', '.');

  const parsed = Number(raw);
  return {
    value: Number.isFinite(parsed) ? parsed : undefined,
    provided: true,
    valid: Number.isFinite(parsed) && parsed >= 0,
  };
}

function optionalString(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function normalizeRow(row: RawRow): NormalizedRow {
  const lower = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));
  const price = parsePrice(lower.preco ?? lower.valor ?? lower.preco_de_aquisicao ?? lower.purchase_price);

  return {
    patrimonyNumber: String(lower.patrimonio ?? lower.patrimony ?? lower.patrimonynumber ?? lower.patrimony_number ?? '').trim(),
    name: String(lower.nome ?? lower.produto ?? lower.name ?? lower.item ?? '').trim(),
    poolName: String(lower.setor ?? lower.setor_de_destino ?? lower.pool ?? lower.pool_de_destino ?? lower.grupo ?? '').trim(),
    categoryName: String(lower.categoria ?? lower.category ?? '').trim(),
    description: optionalString(lower.descricao ?? lower.description),
    manufacturer: optionalString(lower.fabricante ?? lower.manufacturer),
    model: optionalString(lower.modelo ?? lower.model),
    purchasePrice: price.value,
    priceWasProvided: price.provided,
    priceIsValid: price.valid,
    location: optionalString(lower.localizacao ?? lower.local ?? lower.location),
    responsible: optionalString(lower.responsavel ?? lower.responsible),
  };
}

function rowsFromXml(parsed: any): RawRow[] {
  const candidates = parsed.itens?.item ?? parsed.items?.item ?? parsed.ativos?.ativo ?? parsed.assets?.asset ?? parsed.item ?? [];
  if (!candidates) return [];
  return (Array.isArray(candidates) ? candidates : [candidates]).filter((item) => item && typeof item === 'object');
}

async function readRows(filename: string, buffer: Buffer) {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  let rows: RawRow[] = [];

  if (['xlsx', 'xls', 'csv'].includes(extension)) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error('A planilha não possui nenhuma aba para leitura.');
    rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '' });
  } else if (extension === 'xml') {
    if (/<!DOCTYPE|<!ENTITY/i.test(buffer.toString('utf8'))) fail(400, 'XML com declarações de entidades não é aceito.');
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(buffer.toString('utf8'));
    rows = rowsFromXml(parsed);
  } else {
    const error = new Error('Formato não suportado. Use CSV, XLS, XLSX ou XML.') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  if (rows.length > 5000) fail(400, 'O limite é de 5.000 linhas por arquivo. Divida a carga.');
  return { extension, rows };
}

function buildReferenceMap<T extends { id: string; name: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = normalizeReference(item.name);
    const current = map.get(key) ?? [];
    current.push(item);
    map.set(key, current);
  }
  return map;
}

async function validateRows(rows: RawRow[], request: FastifyRequest): Promise<ResolvedRow[]> {
  const [pools, categories] = await Promise.all([
    prisma.pool.findMany({ where: { ...poolWhere(request), active: true }, select: { id: true, name: true } }),
    prisma.category.findMany({ select: { id: true, name: true, customFields: true } }),
  ]);

  const poolMap = buildReferenceMap(pools);
  const categoryMap = buildReferenceMap(categories);
  const duplicateKeys = new Set<string>();
  const resolvedRows: ResolvedRow[] = [];

  for (let index = 0; index < rows.length; index++) {
    const normalized = normalizeRow(rows[index]);
    const errors: string[] = [];
    let poolId: string | undefined;
    let categoryId: string | undefined;
    let poolResolvedName: string | undefined;
    let categoryResolvedName: string | undefined;

    if (!normalized.patrimonyNumber) errors.push('Patrimônio é obrigatório.');
    if (!normalized.name) errors.push('Nome é obrigatório.');
    if (!normalized.poolName) errors.push('Setor é obrigatório.');
    if (!normalized.categoryName) errors.push('Categoria é obrigatória.');
    if (normalized.priceWasProvided && !normalized.priceIsValid) errors.push('Preço inválido. Informe um número maior ou igual a zero.');

    if (normalized.poolName) {
      const matches = poolMap.get(normalizeReference(normalized.poolName)) ?? [];
      if (matches.length === 0) errors.push(`Setor "${normalized.poolName}" não encontrado.`);
      else if (matches.length > 1) errors.push(`Setor "${normalized.poolName}" é ambíguo. Ajuste o cadastro antes de importar.`);
      else {
        poolId = matches[0].id;
        poolResolvedName = matches[0].name;
      }
    }

    if (normalized.categoryName) {
      const matches = categoryMap.get(normalizeReference(normalized.categoryName)) ?? [];
      if (matches.length === 0) errors.push(`Categoria "${normalized.categoryName}" não encontrada.`);
      else if (matches.length > 1) errors.push(`Categoria "${normalized.categoryName}" é ambígua. Ajuste o cadastro antes de importar.`);
      else {
        categoryId = matches[0].id;
        categoryResolvedName = matches[0].name;
      }
    }

    if (poolId && normalized.patrimonyNumber) {
      const duplicateKey = `${poolId}::${normalizeReference(normalized.patrimonyNumber)}`;
      if (duplicateKeys.has(duplicateKey)) errors.push('Patrimônio duplicado para o mesmo Setor dentro deste arquivo.');
      else duplicateKeys.add(duplicateKey);
    }

    resolvedRows.push({
      ...normalized,
      row: index + 2,
      poolId,
      categoryId,
      poolResolvedName,
      categoryResolvedName,
      errors,
    });
  }

  const candidates = resolvedRows.filter((row) => row.errors.length === 0 && row.poolId);
  if (candidates.length) {
    const existing = await prisma.asset.findMany({
      where: {
        OR: candidates.map((row) => ({ poolId: row.poolId!, patrimonyNumber: row.patrimonyNumber })),
      },
      select: { id: true, poolId: true, patrimonyNumber: true, categoryId: true, updatedAt: true, archivedAt: true, customValues: { include: { customField: true } } },
    });
    const existingKeys = new Set(existing.map((item) => `${item.poolId}::${item.patrimonyNumber}`));
    for (const row of candidates) {
      row.action = existingKeys.has(`${row.poolId}::${row.patrimonyNumber}`) ? 'UPDATE' : 'CREATE';
      const current = existing.find(item => item.poolId === row.poolId && item.patrimonyNumber === row.patrimonyNumber);
      row.existingItemId = current?.id;
      row.version = current?.updatedAt.toISOString();
      if (current?.archivedAt) row.errors.push('Reative o ativo antes de atualizar por importação.');
      const fields = categories.find(category => category.id === row.categoryId)?.customFields || [];
      const values = current && current.categoryId === row.categoryId ? Object.fromEntries(current.customValues.map(value => [value.customField.key, value.value])) : {};
      try { validateCustomValues(fields, values); }
      catch (error) { row.errors.push(error instanceof Error ? error.message : 'Campos específicos da categoria inválidos.'); }
    }
  }

  return resolvedRows;
}

function previewPayload(filename: string, rows: ResolvedRow[]) {
  const validRows = rows.filter((row) => row.errors.length === 0).length;
  return {
    fileName: filename,
    totalRows: rows.length,
    validRows,
    errorRows: rows.length - validRows,
    rows: rows.map((row) => ({
      row: row.row,
      patrimonyNumber: row.patrimonyNumber,
      name: row.name,
      pool: row.poolResolvedName ?? row.poolName,
      category: row.categoryResolvedName ?? row.categoryName,
      action: row.action,
      valid: row.errors.length === 0,
      errors: row.errors,
    })),
  };
}

function createTemplate(pools: Array<{ name: string }>, categories: Array<{ name: string }>) {
  const workbook = XLSX.utils.book_new();
  const headers = [['patrimonio', 'nome', 'setor', 'categoria', 'descricao', 'fabricante', 'modelo', 'preco', 'localizacao', 'responsavel']];
  const examplePool = pools.find((pool) => normalizeReference(pool.name) === 'ti')?.name ?? pools[0]?.name ?? 'TI';
  const exampleCategory = categories.find((category) => normalizeReference(category.name) === 'notebook')?.name ?? categories[0]?.name ?? 'Notebook';
  const example = [
    ['TI-0001', 'Notebook corporativo', examplePool, exampleCategory, 'Equipamento de uso interno', 'Dell', 'Latitude 5450', 6500, 'Matriz', 'João da Silva'],
  ];
  const assetsSheet = XLSX.utils.aoa_to_sheet([...headers, ...example]);
  assetsSheet['!cols'] = [
    { wch: 16 }, { wch: 28 }, { wch: 18 }, { wch: 20 }, { wch: 34 },
    { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(workbook, assetsSheet, 'ATIVOS');

  const poolsSheet = XLSX.utils.aoa_to_sheet([['SETORES DISPONÍVEIS'], ...pools.map((pool) => [pool.name])]);
  poolsSheet['!cols'] = [{ wch: 32 }];
  XLSX.utils.book_append_sheet(workbook, poolsSheet, 'SETORES');

  const categoriesSheet = XLSX.utils.aoa_to_sheet([['CATEGORIAS DISPONÍVEIS'], ...categories.map((category) => [category.name])]);
  categoriesSheet['!cols'] = [{ wch: 32 }];
  XLSX.utils.book_append_sheet(workbook, categoriesSheet, 'CATEGORIAS');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}


type NonPatrimonialNormalizedRow = {
  internalCode: string;
  name: string;
  poolName: string;
  categoryName: string;
  quantity?: number;
  quantityWasProvided: boolean;
  quantityIsValid: boolean;
  description?: string;
  manufacturer?: string;
  model?: string;
  location?: string;
  responsible?: string;
};

type NonPatrimonialResolvedRow = NonPatrimonialNormalizedRow & {
  row: number;
  poolId?: string;
  categoryId?: string;
  poolResolvedName?: string;
  categoryResolvedName?: string;
  existingItemId?: string;
  errors: string[];
  action?: 'CREATE' | 'UPDATE';
  quantityBefore?: number;
  version?: string;
};

function parseQuantity(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { value: undefined, provided: false, valid: false };
  }
  const parsed = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 1_000_000;
  return { value: valid ? parsed : undefined, provided: true, valid };
}

function normalizeNonPatrimonialRow(row: RawRow): NonPatrimonialNormalizedRow {
  const lower = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));
  const quantity = parseQuantity(lower.quantidade ?? lower.quantity ?? lower.qtd);
  return {
    internalCode: String(lower.codigo_interno ?? lower.codigointerno ?? lower.internal_code ?? lower.internalcode ?? '').trim().toUpperCase(),
    name: String(lower.nome ?? lower.produto ?? lower.name ?? lower.item ?? '').trim(),
    poolName: String(lower.setor ?? lower.setor_de_destino ?? lower.pool ?? lower.pool_de_destino ?? '').trim(),
    categoryName: String(lower.categoria ?? lower.category ?? '').trim(),
    quantity: quantity.value,
    quantityWasProvided: quantity.provided,
    quantityIsValid: quantity.valid,
    description: optionalString(lower.descricao ?? lower.description),
    manufacturer: optionalString(lower.fabricante ?? lower.manufacturer),
    model: optionalString(lower.modelo ?? lower.model),
    location: optionalString(lower.localizacao ?? lower.local ?? lower.location),
    responsible: optionalString(lower.responsavel ?? lower.responsible),
  };
}

async function validateNonPatrimonialRows(rows: RawRow[], request: FastifyRequest, mode: ImportMode = 'CREATE'): Promise<NonPatrimonialResolvedRow[]> {
  const [pools, categories] = await Promise.all([
    prisma.pool.findMany({ where: { ...poolWhere(request), active: true }, select: { id: true, name: true } }),
    prisma.category.findMany({ select: { id: true, name: true } }),
  ]);
  const poolMap = buildReferenceMap(pools);
  const categoryMap = buildReferenceMap(categories);
  const normalizedRows = rows.map(normalizeNonPatrimonialRow);
  const requestedCodes = [...new Set(normalizedRows.map(row => row.internalCode).filter(Boolean))];
  const existingItems = requestedCodes.length
    ? await prisma.nonPatrimonialItem.findMany({
        where: { internalCode: { in: requestedCodes }, ...poolScope(request) },
        select: { id: true, internalCode: true, poolId: true, quantity: true, updatedAt: true, active: true },
      })
    : [];
  const existingByCode = new Map(existingItems.map(item => [item.internalCode.toUpperCase(), item]));
  const seenCodes = new Set<string>();
  const seenNewRows = new Set<string>();
  const result: NonPatrimonialResolvedRow[] = [];

  for (let index = 0; index < normalizedRows.length; index++) {
    const normalized = normalizedRows[index];
    const errors: string[] = [];
    let poolId: string | undefined;
    let categoryId: string | undefined;
    let poolResolvedName: string | undefined;
    let categoryResolvedName: string | undefined;
    let existingItemId: string | undefined;

    if (!normalized.name) errors.push('Nome é obrigatório.');
    if (!normalized.poolName) errors.push('Setor é obrigatório.');
    if (!normalized.categoryName) errors.push('Categoria é obrigatória.');
    if (mode !== 'UPDATE' && (!normalized.quantityWasProvided || !normalized.quantityIsValid)) errors.push('Quantidade é obrigatória e deve ser um inteiro entre 0 e 1.000.000.');

    if (normalized.poolName) {
      const matches = poolMap.get(normalizeReference(normalized.poolName)) ?? [];
      if (matches.length === 0) errors.push(`Setor "${normalized.poolName}" não encontrado.`);
      else if (matches.length > 1) errors.push(`Setor "${normalized.poolName}" é ambíguo.`);
      else { poolId = matches[0].id; poolResolvedName = matches[0].name; }
    }

    if (normalized.categoryName) {
      const matches = categoryMap.get(normalizeReference(normalized.categoryName)) ?? [];
      if (matches.length === 0) errors.push(`Categoria "${normalized.categoryName}" não encontrada.`);
      else if (matches.length > 1) errors.push(`Categoria "${normalized.categoryName}" é ambígua.`);
      else { categoryId = matches[0].id; categoryResolvedName = matches[0].name; }
    }

    if (!normalized.internalCode && poolId && categoryId && normalized.name) {
      const newRowKey = [poolId, categoryId, normalizeReference(normalized.name), normalizeReference(normalized.manufacturer), normalizeReference(normalized.model), normalizeReference(normalized.location)].join('::');
      if (seenNewRows.has(newRowKey)) errors.push('Item novo duplicado dentro deste arquivo. Consolide a quantidade em uma única linha.');
      seenNewRows.add(newRowKey);
    }

    if (normalized.internalCode) {
      if (seenCodes.has(normalized.internalCode)) errors.push('Código interno duplicado dentro deste arquivo.');
      seenCodes.add(normalized.internalCode);
      const existing = existingByCode.get(normalized.internalCode);
      if (!existing) errors.push(`Código interno "${normalized.internalCode}" não encontrado. Deixe o código em branco para criar um novo item.`);
      else {
        existingItemId = existing.id;
        if (!existing.active) errors.push('Reative o item antes de importar alterações.');
        if (poolId && existing.poolId !== poolId) errors.push('O Setor informado é diferente do Setor atual do item. Use a movimentação entre Setores no sistema.');
      }
    }

    result.push({
      ...normalized,
      row: index + 2,
      poolId,
      categoryId,
      poolResolvedName,
      categoryResolvedName,
      existingItemId,
      quantityBefore: existingItemId ? existingByCode.get(normalized.internalCode)?.quantity : 0,
      version: existingItemId ? existingByCode.get(normalized.internalCode)?.updatedAt.toISOString() : undefined,
      errors,
      action: normalized.internalCode && existingItemId ? 'UPDATE' : 'CREATE',
    });
  }
  return result;
}

function nonPatrimonialPreviewPayload(filename: string, rows: NonPatrimonialResolvedRow[]) {
  const validRows = rows.filter(row => row.errors.length === 0).length;
  return {
    fileName: filename,
    totalRows: rows.length,
    validRows,
    errorRows: rows.length - validRows,
    rows: rows.map(row => ({
      row: row.row,
      internalCode: row.internalCode,
      name: row.name,
      pool: row.poolResolvedName ?? row.poolName,
      category: row.categoryResolvedName ?? row.categoryName,
      quantity: row.quantity ?? null,
      action: row.action,
      valid: row.errors.length === 0,
      errors: row.errors,
    })),
  };
}

function createNonPatrimonialTemplate(pools: Array<{ name: string }>, categories: Array<{ name: string }>) {
  const workbook = XLSX.utils.book_new();
  const headers = [['codigo_interno', 'nome', 'setor', 'categoria', 'quantidade', 'descricao', 'fabricante', 'modelo', 'localizacao', 'responsavel']];
  const examplePool = pools[0]?.name ?? 'Administrativo';
  const exampleCategory = categories.find(category => normalizeReference(category.name) === 'copa e cozinha')?.name ?? categories.find(category => normalizeReference(category.name) === 'outros')?.name ?? categories[0]?.name ?? 'Outros';
  const example = [['', 'Xícara de café', examplePool, exampleCategory, 24, 'Uso na copa', '', '', 'Copa', '']];
  const sheet = XLSX.utils.aoa_to_sheet([...headers, ...example]);
  sheet['!cols'] = [
    { wch: 18 }, { wch: 28 }, { wch: 22 }, { wch: 24 }, { wch: 12 },
    { wch: 34 }, { wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, 'ITENS_NAO_PATRIMONIADOS');
  const poolsSheet = XLSX.utils.aoa_to_sheet([['SETORES DISPONÍVEIS'], ...pools.map(pool => [pool.name])]);
  XLSX.utils.book_append_sheet(workbook, poolsSheet, 'SETORES');
  const categoriesSheet = XLSX.utils.aoa_to_sheet([['CATEGORIAS DISPONÍVEIS'], ...categories.map(category => [category.name])]);
  XLSX.utils.book_append_sheet(workbook, categoriesSheet, 'CATEGORIAS');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export async function importRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (request) => {
    const query = z.object({ kind: z.nativeEnum(ImportKind).optional() }).parse(request.query);
    const baseWhere: Prisma.ImportJobWhereInput = {
      ...(request.poolIds === null ? {} : { userId: request.user.sub }),
      ...(query.kind ? { kind: query.kind } : {}),
    };
    const jobs = await prisma.importJob.findMany({ where: baseWhere, orderBy: { createdAt: 'desc' }, take: 50 });
    return request.poolIds === null ? jobs : jobs.filter(job => job.poolIds.every(id => request.poolIds!.includes(id)));
  });

  const readableJob = async (request: FastifyRequest, id: string) => {
    const job = await prisma.importJob.findFirst({ where: { id, ...(request.poolIds === null ? {} : { userId: request.user.sub }) } });
    if (!job || (request.poolIds !== null && !job.poolIds.every(poolId => request.poolIds!.includes(poolId)))) fail(404, 'Importação não encontrada ou sem acesso.');
    return job;
  };
  app.get('/:id', async request => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const job = await readableJob(request, id);
    return { ...job, errors: readImportErrors(job.errors) };
  });
  app.get('/:id/errors.csv', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const job = await readableJob(request, id);
    return reply.header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="linhas_rejeitadas.csv"')
      .send(rejectedRowsCsv(readImportErrors(job.errors)));
  });

  app.get('/template', async (request, reply) => {
    const [pools, categories] = await Promise.all([
      prisma.pool.findMany({ where: { ...poolWhere(request), active: true }, orderBy: { name: 'asc' }, select: { name: true } }),
      prisma.category.findMany({ orderBy: { name: 'asc' }, select: { name: true } }),
    ]);
    const file = createTemplate(pools, categories);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="modelo_importacao_ativos.xlsx"')
      .send(file);
  });


  app.get('/non-patrimonial/template', { preHandler: app.requirePermission(PermissionCode.IMPORT_NON_PATRIMONIAL) }, async (request, reply) => {
    const [pools, categories] = await Promise.all([
      prisma.pool.findMany({ where: { ...poolWhere(request), active: true }, orderBy: { name: 'asc' }, select: { name: true } }),
      prisma.category.findMany({ orderBy: { name: 'asc' }, select: { name: true } }),
    ]);
    const file = createNonPatrimonialTemplate(pools, categories);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="modelo_importacao_itens_nao_patrimoniados.xlsx"')
      .send(file);
  });

  // The confirmation is bound to a persisted preview. Retries reuse its UUID.
  for (const kind of [ImportKind.ASSET, ImportKind.NON_PATRIMONIAL]) {
    const path = kind === ImportKind.ASSET ? '/assets' : '/non-patrimonial';
    const permission = kind === ImportKind.ASSET ? PermissionCode.IMPORT_ASSETS : PermissionCode.IMPORT_NON_PATRIMONIAL;
    app.post(`${path}/preview`, { preHandler: app.requirePermission(permission) }, async (request, reply) => {
      const { mode } = z.object({ mode: importModeSchema.default('CREATE') }).parse(request.query);
      if (kind === ImportKind.ASSET && mode === 'SET_BALANCE') fail(400, 'Ativos individuais não possuem saldo.');
      const file = await request.file();
      if (!file) fail(400, 'Arquivo obrigatório.');
      const buffer = await file.toBuffer();
      const { extension, rows } = await readRows(file.filename, buffer);
      if (!rows.length) fail(400, 'Nenhum registro encontrado.');
      if (rows.length > 5000) fail(400, 'Use arquivos com até 5.000 linhas por importação.');
      const fileHash = createHash('sha256').update(buffer).digest('hex');
      const signature = createHash('sha256').update(JSON.stringify({ kind, mode, fileHash })).digest('hex');
      if (mode === 'CREATE' && await prisma.stockOperation.findFirst({ where: { userId: request.user.sub, kind: 'IMPORT_COMPLETE', inputHash: signature } })) fail(409, 'Este arquivo já foi processado neste modo. Consulte o histórico antes de criar outra carga.');
      const validated = kind === ImportKind.ASSET ? await validateRows(rows, request) : await validateNonPatrimonialRows(rows, request, mode);
      for (const row of validated) {
        if (mode === 'CREATE' && row.existingItemId) row.errors.push('O registro já existe. Use o modo Atualizar cadastro.');
        if (mode !== 'CREATE' && !row.existingItemId) row.errors.push('O registro precisa existir neste modo. Informe seu código e Setor corretos.');
      }
      const previewId = randomUUID();
      const snapshot = { kind, mode, fileHash, fileName: file.filename, extension, rows: validated.map((row, index) => ({ ...row, sourceData: rows[index] })) };
      await prisma.stockOperation.create({ data: { id: previewId, userId: request.user.sub, kind: 'IMPORT_PREVIEW', inputHash: signature, result: JSON.parse(JSON.stringify(snapshot)) } });
      const payload = kind === ImportKind.ASSET ? previewPayload(file.filename, validated as ResolvedRow[]) : nonPatrimonialPreviewPayload(file.filename, validated as NonPatrimonialResolvedRow[]);
      return { ...payload, previewId, mode, rows: payload.rows.map((row, index) => ({ ...row, quantityBefore: (validated[index] as NonPatrimonialResolvedRow).quantityBefore ?? null, quantityAfter: kind === ImportKind.NON_PATRIMONIAL ? (mode === 'UPDATE' ? (validated[index] as NonPatrimonialResolvedRow).quantityBefore : (validated[index] as NonPatrimonialResolvedRow).quantity) : null })) };
    });

    app.post(path, { preHandler: app.requirePermission(permission) }, async (request, reply) => {
      const previewId = z.string().uuid('Analise o arquivo antes de confirmar a importação.').parse(request.headers['x-request-id']);
      const preview = await prisma.stockOperation.findUnique({ where: { id: previewId } });
      if (!preview || preview.kind !== 'IMPORT_PREVIEW' || preview.userId !== request.user.sub) fail(404, 'Análise não encontrada ou sem acesso.');
      const snapshot = preview.result as unknown as { kind: ImportKind; mode: ImportMode; fileHash: string; fileName: string; extension: string; rows: Array<ResolvedRow & Partial<NonPatrimonialResolvedRow> & { sourceData?: RawRow }> };
      if (snapshot.kind !== kind) fail(409, 'A análise pertence a outro tipo de importação.');
      const file = await request.file();
      if (!file) fail(400, 'Arquivo obrigatório.');
      const buffer = await file.toBuffer();
      if (createHash('sha256').update(buffer).digest('hex') !== snapshot.fileHash) fail(409, 'O arquivo mudou. Faça uma nova análise.');
      const pools = [...new Set(snapshot.rows.flatMap(row => row.poolId && !row.errors.length ? [row.poolId] : []))];
      const authorize = async (tx: Prisma.TransactionClient) => { for (const id of pools) await writablePool(request, id, tx); };
      await prisma.$transaction(authorize);
      const executionId = snapshot.mode === 'CREATE' ? `${request.user.sub}:${preview.inputHash}` : previewId;
      const completed = await prisma.stockOperation.findUnique({ where: { id: `${executionId}:complete` } });
      if (completed) {
        const job = completed.result as unknown as { errorRows: number };
        return reply.status(job.errorRows ? 207 : 201).send(job);
      }
      if (Date.now() - preview.createdAt.getTime() > 24 * 60 * 60 * 1000) fail(409, 'Análise expirada. Analise o arquivo novamente.');
      let successRows = 0;
      const errors: ImportError[] = snapshot.rows.filter(row => row.errors.length).map(row => ({ row: row.row, message: row.errors.join(' '), data: row.sourceData }));
      for (const row of snapshot.rows.filter(row => !row.errors.length && row.poolId && row.categoryId)) {
        try {
          await operation(request, `${executionId}:row:${row.row}`, 'IMPORT_ROW', { kind, mode: snapshot.mode, fileHash: snapshot.fileHash, row: row.row }, async tx => { await writablePool(request, row.poolId!, tx); }, async tx => {
            if (!await tx.category.findUnique({ where: { id: row.categoryId! } })) fail(409, 'Categoria removida após a análise.');
            if (kind === ImportKind.ASSET) {
              const current = row.existingItemId ? await tx.asset.findUnique({ where: { id: row.existingItemId } }) : null;
              if (snapshot.mode === 'UPDATE' && (!current || current.archivedAt || current.poolId !== row.poolId || current.updatedAt.toISOString() !== row.version)) fail(409, 'O ativo mudou após a análise. Analise novamente.');
              if (snapshot.mode === 'CREATE' && await tx.asset.findFirst({ where: { poolId: row.poolId, patrimonyNumber: { equals: row.patrimonyNumber, mode: 'insensitive' } } })) fail(409, 'O patrimônio já existe neste Setor.');
              const fields = await tx.customField.findMany({ where: { categoryId: row.categoryId! } });
              const retained = current && current.categoryId === row.categoryId ? await tx.assetCustomValue.findMany({ where: { assetId: current.id }, include: { customField: true } }) : [];
              validateCustomValues(fields, Object.fromEntries(retained.map(value => [value.customField.key, value.value])));
              const values = { name: row.name, description: row.description, manufacturer: row.manufacturer, model: row.model, ...(row.priceWasProvided ? { purchasePrice: new Prisma.Decimal(row.purchasePrice!) } : {}), location: row.location, responsible: row.responsible, categoryId: row.categoryId! };
              if (current && current.categoryId !== row.categoryId) await tx.assetCustomValue.deleteMany({ where: { assetId: current.id } });
              const asset = current ? await tx.asset.update({ where: { id: current.id }, data: { ...values, ...(current.categoryId !== row.categoryId ? { assetTypeId: null } : {}) } }) : await tx.asset.create({ data: { ...values, poolId: row.poolId!, patrimonyNumber: row.patrimonyNumber } });
              if (current && (current.location !== asset.location || current.responsible !== asset.responsible)) await tx.assetMovement.create({ data: { assetId: asset.id, fromPoolId: current.poolId, toPoolId: asset.poolId, fromLocation: current.location, toLocation: asset.location, fromResponsible: current.responsible, toResponsible: asset.responsible, notes: `Atualização pela importação ${snapshot.fileName}.` } });
              await audit(request, current ? 'IMPORT_UPDATE' : 'IMPORT_CREATE', 'Asset', asset.id, current || undefined, asset, tx);
            } else {
              const current = row.existingItemId ? await tx.nonPatrimonialItem.findUnique({ where: { id: row.existingItemId } }) : null;
              if (snapshot.mode !== 'CREATE' && (!current || !current.active || current.poolId !== row.poolId || current.updatedAt.toISOString() !== row.version)) fail(409, 'O item ou saldo mudou após a análise. Analise novamente.');
              if (snapshot.mode === 'SET_BALANCE') {
                const updated = await tx.nonPatrimonialItem.update({ where: { id: current!.id }, data: { quantity: row.quantity! } });
                if (current!.quantity !== updated.quantity) await tx.nonPatrimonialMovement.create({ data: { itemId: updated.id, userId: request.user.sub, type: NonPatrimonialMovementType.IMPORT_SET, quantity: Math.abs(updated.quantity - current!.quantity), quantityBefore: current!.quantity, quantityAfter: updated.quantity, fromPoolId: updated.poolId, toPoolId: updated.poolId, notes: `Saldo definido pela importação ${snapshot.fileName}.` } });
                await audit(request, 'IMPORT_SET_BALANCE', 'NonPatrimonialItem', updated.id, current, updated, tx);
              } else {
                const values = { name: row.name, description: row.description, manufacturer: row.manufacturer, model: row.model, location: row.location, responsible: row.responsible, categoryId: row.categoryId! };
                const item = current ? await tx.nonPatrimonialItem.update({ where: { id: current.id }, data: values }) : await tx.nonPatrimonialItem.create({ data: { ...values, poolId: row.poolId!, internalCode: await nextNonPatrimonialCode(tx), quantity: row.quantity! } });
                if (!current && item.quantity) await tx.nonPatrimonialMovement.create({ data: { itemId: item.id, userId: request.user.sub, type: NonPatrimonialMovementType.INITIAL, quantity: item.quantity, quantityBefore: 0, quantityAfter: item.quantity, toPoolId: item.poolId, notes: `Cadastro pela importação ${snapshot.fileName}.` } });
                await audit(request, current ? 'IMPORT_UPDATE' : 'IMPORT_CREATE', 'NonPatrimonialItem', item.id, current || undefined, item, tx);
              }
            }
            return { row: row.row, success: true };
          });
          successRows++;
        } catch (error) { errors.push({ row: row.row, message: error instanceof Error && 'statusCode' in error ? error.message : 'Falha ao gravar a linha. Verifique os vínculos.', data: row.sourceData }); }
      }
      const job = await operation(request, `${executionId}:complete`, 'IMPORT_COMPLETE', { kind, mode: snapshot.mode, fileHash: snapshot.fileHash }, authorize, tx => tx.importJob.create({ data: { kind, userId: request.user.sub, poolIds: pools, fileName: snapshot.fileName, fileType: snapshot.extension, totalRows: snapshot.rows.length, successRows, errorRows: errors.length, errors: JSON.parse(JSON.stringify(errors)) } }));
      return reply.status(job.errorRows ? 207 : 201).send(job);
    });
  }
}
