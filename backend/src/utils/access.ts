import { UserRole, type Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { visiblePoolFilter } from './visibility.js';
import { prisma } from '../plugins/prisma.js';

export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

export function poolWhere(request: FastifyRequest, poolId?: string): Prisma.PoolWhereInput {
  const scope = poolScope(request, poolId);
  return scope.poolId === undefined ? {} : { id: scope.poolId };
}
export function poolScope(request: FastifyRequest, poolId?: string): { poolId?: string | { in: string[] } } {
  return visiblePoolFilter(request.user?.role, request.poolIds, poolId);
}
export function assertPool(request: FastifyRequest, poolId: string) { poolScope(request, poolId); }

// Recheck write access inside the transaction, including a grant revoked after authentication.
export async function writablePool(request: FastifyRequest, poolId: string, db: Prisma.TransactionClient = prisma) {
  assertPool(request, poolId);
  const actor = await db.user.findUnique({ where: { id: request.user.sub }, select: { active: true, role: true, poolAccess: { select: { poolId: true } } } });
  if (!actor?.active || (actor.role !== UserRole.ADMIN && actor.role !== UserRole.MANAGER)) fail(403, 'Sem permissão de escrita.');
  if (actor.role !== UserRole.ADMIN && !actor.poolAccess.some(p => p.poolId === poolId)) fail(404, 'Pool ou recurso não encontrado ou sem acesso.');
  const pool = await db.pool.findUnique({ where: { id: poolId } });
  if (!pool || !pool.active) fail(400, 'O Pool precisa existir e estar ativo.');
  return pool;
}

export async function requireAsset(request: FastifyRequest, id: string, db: Prisma.TransactionClient = prisma) {
  const asset = await db.asset.findFirst({ where: { id, ...poolScope(request) } });
  if (!asset) fail(404, 'Ativo não encontrado ou sem acesso.');
  return asset;
}

export async function validateAssetLinks(db: Prisma.TransactionClient, data: { poolId: string; categoryId: string; folderId?: string | null; assetTypeId?: string | null }) {
  const category = await db.category.findUnique({ where: { id: data.categoryId } });
  if (!category) fail(400, 'Categoria não encontrada.');
  if (data.folderId) {
    const folder = await db.folder.findUnique({ where: { id: data.folderId } });
    if (!folder || folder.poolId !== data.poolId) fail(400, 'A pasta deve pertencer ao Pool do ativo.');
  }
  if (data.assetTypeId) {
    const type = await db.assetType.findUnique({ where: { id: data.assetTypeId } });
    if (!type || type.categoryId !== data.categoryId) fail(400, 'O tipo deve pertencer à categoria do ativo.');
  }
}

export function descendants<T extends { id: string; parentId: string | null }>(categories: T[], id: string): string[] {
  const ids = new Set<string>([id]);
  const pending = [id];
  while (pending.length) {
    const current = pending.pop();
    for (const child of categories) if (child.parentId === current && !ids.has(child.id)) {
      ids.add(child.id); pending.push(child.id);
    }
  }
  return [...ids];
}
