import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PermissionCode, Prisma } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import * as XLSX from 'xlsx';
import { prisma } from '../../plugins/prisma.js';
import { poolWhere, writablePool, fail } from '../../utils/access.js';
import { serial } from '../../utils/transaction.js';
import { audit } from '../../utils/audit.js';

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
    poolName: String(lower.pool ?? lower.pool_de_destino ?? lower.grupo ?? '').trim(),
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
  const candidates = parsed.items?.item ?? parsed.ativos?.ativo ?? parsed.assets?.asset ?? parsed.item ?? [];
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
    prisma.category.findMany({ select: { id: true, name: true } }),
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
    if (!normalized.poolName) errors.push('Pool é obrigatório.');
    if (!normalized.categoryName) errors.push('Categoria é obrigatória.');
    if (normalized.priceWasProvided && !normalized.priceIsValid) errors.push('Preço inválido. Informe um número maior ou igual a zero.');

    if (normalized.poolName) {
      const matches = poolMap.get(normalizeReference(normalized.poolName)) ?? [];
      if (matches.length === 0) errors.push(`Pool "${normalized.poolName}" não encontrado.`);
      else if (matches.length > 1) errors.push(`Pool "${normalized.poolName}" é ambíguo. Ajuste o cadastro antes de importar.`);
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
      if (duplicateKeys.has(duplicateKey)) errors.push('Patrimônio duplicado para o mesmo Pool dentro deste arquivo.');
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
      select: { poolId: true, patrimonyNumber: true },
    });
    const existingKeys = new Set(existing.map((item) => `${item.poolId}::${item.patrimonyNumber}`));
    for (const row of candidates) {
      row.action = existingKeys.has(`${row.poolId}::${row.patrimonyNumber}`) ? 'UPDATE' : 'CREATE';
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
  const headers = [['patrimonio', 'nome', 'pool', 'categoria', 'descricao', 'fabricante', 'modelo', 'preco', 'localizacao', 'responsavel']];
  const examplePool = pools.find((pool) => normalizeReference(pool.name) === 'ti')?.name ?? pools[0]?.name ?? 'TI';
  const exampleCategory = categories.find((category) => normalizeReference(category.name) === 'notebook')?.name ?? categories[0]?.name ?? 'Notebook';
  const example = [
    ['TI-0001', 'Notebook corporativo', examplePool, exampleCategory, 'Equipamento de uso interno', 'Dell', 'Latitude 5450', 6500, 'Matriz', 'João da Silva'],
  ];
  const assetsSheet = XLSX.utils.aoa_to_sheet(headers);
  assetsSheet['!cols'] = [
    { wch: 16 }, { wch: 28 }, { wch: 18 }, { wch: 20 }, { wch: 34 },
    { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(workbook, assetsSheet, 'ATIVOS');

  const poolsSheet = XLSX.utils.aoa_to_sheet([['POOLS DISPONÍVEIS'], ...pools.map((pool) => [pool.name])]);
  poolsSheet['!cols'] = [{ wch: 32 }];
  XLSX.utils.book_append_sheet(workbook, poolsSheet, 'POOLS');

  const categoriesSheet = XLSX.utils.aoa_to_sheet([['CATEGORIAS DISPONÍVEIS'], ...categories.map((category) => [category.name])]);
  categoriesSheet['!cols'] = [{ wch: 32 }];
  XLSX.utils.book_append_sheet(workbook, categoriesSheet, 'CATEGORIAS');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export async function importRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (request) => {
    const jobs = await prisma.importJob.findMany({ where: request.poolIds === null ? {} : { userId: request.user.sub }, orderBy: { createdAt: 'desc' }, take: 50 });
    return request.poolIds === null ? jobs : jobs.filter(job => job.poolIds.every(id => request.poolIds!.includes(id)));
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

  app.post('/assets/preview', { preHandler: app.requirePermission(PermissionCode.IMPORT_ASSETS) }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ message: 'Arquivo obrigatório.' });

    const buffer = await data.toBuffer();
    const { rows } = await readRows(data.filename, buffer);
    if (!rows.length) return reply.status(400).send({ message: 'Nenhum registro foi encontrado no arquivo.' });

    const validated = await validateRows(rows, request);
    return previewPayload(data.filename, validated);
  });

  app.post('/assets', { preHandler: app.requirePermission(PermissionCode.IMPORT_ASSETS) }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ message: 'Arquivo obrigatório.' });

    const buffer = await data.toBuffer();
    const { extension, rows } = await readRows(data.filename, buffer);
    if (!rows.length) return reply.status(400).send({ message: 'Nenhum registro foi encontrado no arquivo.' });

    const validated = await validateRows(rows, request);
    let successRows = 0;
    const errors: Array<{ row: number; patrimonyNumber: string | null; message: string }> = validated
      .filter((row) => row.errors.length > 0)
      .map((row) => ({ row: row.row, patrimonyNumber: row.patrimonyNumber || null, message: row.errors.join(' ') }));

    for (const row of validated.filter((item) => item.errors.length === 0 && item.poolId && item.categoryId)) {
      try {
        await serial(async tx => {
          await writablePool(request, row.poolId!, tx);
          if (!await tx.category.findUnique({ where: { id: row.categoryId! } })) fail(400, 'Categoria removida após a análise.');
          const current = await tx.asset.findUnique({ where: { poolId_patrimonyNumber: { poolId: row.poolId!, patrimonyNumber: row.patrimonyNumber } } });
          const data = {
            name: row.name, description: row.description, manufacturer: row.manufacturer, model: row.model,
            ...(row.priceWasProvided ? { purchasePrice: new Prisma.Decimal(row.purchasePrice!) } : {}),
            location: row.location, responsible: row.responsible, categoryId: row.categoryId!,
          };
          if (current && current.categoryId !== row.categoryId) await tx.assetCustomValue.deleteMany({ where: { assetId: current.id } });
          const asset = current ? await tx.asset.update({ where: { id: current.id }, data: { ...data, ...(current.categoryId !== row.categoryId ? { assetTypeId: null } : {}) } }) :
            await tx.asset.create({ data: { ...data, poolId: row.poolId!, patrimonyNumber: row.patrimonyNumber } });
          await audit(request, current ? 'IMPORT_UPDATE' : 'IMPORT_CREATE', 'Asset', asset.id, current ?? undefined, asset, tx);
        });
        successRows++;
      } catch (error) {
        errors.push({
          row: row.row,
          patrimonyNumber: row.patrimonyNumber,
          message: error instanceof Error && 'statusCode' in error ? error.message : 'Falha ao gravar a linha. Verifique duplicidade ou conflito de dados.',
        });
      }
    }

    const job = await prisma.importJob.create({
      data: {
        userId: request.user.sub,
        poolIds: [...new Set(validated.flatMap(row => row.poolId ? [row.poolId] : []))],
        fileName: data.filename,
        fileType: extension,
        totalRows: rows.length,
        successRows,
        errorRows: errors.length,
        errors,
      },
    });

    return reply.status(errors.length ? 207 : 201).send(job);
  });
}
