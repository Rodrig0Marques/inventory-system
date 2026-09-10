import type { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';

function normalizeKey(key: string) {
  return key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizePrice(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;
  let raw = String(value).replace(/R\$/gi, '').replace(/\s/g, '');
  if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/\./g, '').replace(',', '.');
  else if (raw.includes(',')) raw = raw.replace(',', '.');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeRow(row: Record<string, unknown>) {
  const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [normalizeKey(k), v]));
  return {
    patrimonyNumber: String(lower.patrimonio ?? lower.patrimony ?? lower.patrimonynumber ?? lower.patrimony_number ?? '').trim(),
    name: String(lower.nome ?? lower.produto ?? lower.name ?? lower.item ?? '').trim(),
    description: lower.descricao ? String(lower.descricao) : lower.description ? String(lower.description) : undefined,
    manufacturer: lower.fabricante ? String(lower.fabricante) : lower.manufacturer ? String(lower.manufacturer) : undefined,
    model: lower.modelo ? String(lower.modelo) : lower.model ? String(lower.model) : undefined,
    purchasePrice: normalizePrice(lower.preco ?? lower.valor ?? lower.preco_de_aquisicao ?? lower.purchase_price),
    location: lower.localizacao ?? lower.local ?? lower.location,
    responsible: lower.responsavel ?? lower.responsible,
  };
}

export async function importRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => prisma.importJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }));

  app.post('/assets', { preHandler: app.authorize([UserRole.ADMIN, UserRole.MANAGER]) }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ message: 'Arquivo obrigatório' });

    const multipartFields = data.fields as Record<string, any>;
    const getField = (name: string) => {
      const raw = multipartFields[name];
      const item = Array.isArray(raw) ? raw[0] : raw;
      return item?.value === undefined ? undefined : String(item.value);
    };
    const fields = z.object({ poolId: z.string().min(1), categoryId: z.string().min(1), folderId: z.string().optional() }).parse({
      poolId: getField('poolId'),
      categoryId: getField('categoryId'),
      folderId: getField('folderId'),
    });
    const buffer = await data.toBuffer();
    const extension = data.filename.split('.').pop()?.toLowerCase() || '';
    let rows: Record<string, unknown>[] = [];

    if (['xlsx', 'xls', 'csv'].includes(extension)) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    } else if (extension === 'xml') {
      const parsed = new XMLParser({ ignoreAttributes: false }).parse(buffer.toString('utf8'));
      const candidates = parsed.items?.item ?? parsed.ativos?.ativo ?? parsed.assets?.asset ?? parsed.item ?? [];
      rows = Array.isArray(candidates) ? candidates : [candidates];
    } else {
      return reply.status(400).send({ message: 'Formato não suportado. Use CSV, XLS, XLSX ou XML.' });
    }

    let successRows = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let index = 0; index < rows.length; index++) {
      try {
        const normalized = normalizeRow(rows[index]);
        if (!normalized.patrimonyNumber || !normalized.name) throw new Error('Patrimônio e nome são obrigatórios');
        await prisma.asset.upsert({
          where: { poolId_patrimonyNumber: { poolId: fields.poolId, patrimonyNumber: normalized.patrimonyNumber } },
          update: {
            name: normalized.name,
            description: normalized.description,
            manufacturer: normalized.manufacturer,
            model: normalized.model,
            purchasePrice: normalized.purchasePrice,
            location: normalized.location ? String(normalized.location) : undefined,
            responsible: normalized.responsible ? String(normalized.responsible) : undefined,
          },
          create: {
            patrimonyNumber: normalized.patrimonyNumber,
            name: normalized.name,
            description: normalized.description,
            manufacturer: normalized.manufacturer,
            model: normalized.model,
            purchasePrice: normalized.purchasePrice,
            location: normalized.location ? String(normalized.location) : undefined,
            responsible: normalized.responsible ? String(normalized.responsible) : undefined,
            poolId: fields.poolId,
            folderId: fields.folderId,
            categoryId: fields.categoryId,
          },
        });
        successRows++;
      } catch (error) {
        errors.push({ row: index + 2, message: error instanceof Error ? error.message : 'Erro desconhecido' });
      }
    }

    const job = await prisma.importJob.create({
      data: {
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
