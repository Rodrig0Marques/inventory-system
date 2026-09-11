import { ComponentOrigin, StockMovementType, type Asset, type Folder, type Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../utils/audit.js';
import { fail, poolScope, writablePool } from '../../utils/access.js';
import { afterInstall, quantityForBatch } from './domain.js';

export const componentSchema = z.object({
  profileId: z.string().min(1), quantity: z.number().int().min(1).max(10000), origin: z.nativeEnum(ComponentOrigin),
});
export const componentsSchema = z.array(componentSchema).max(30).superRefine((items, ctx) => {
  if (new Set(items.map(i => i.profileId)).size !== items.length) ctx.addIssue({ code: 'custom', message: 'Informe cada perfil uma vez; ajuste a quantidade na mesma linha.' });
});
export type ComponentInput = z.infer<typeof componentSchema>;

export async function attachComponents(tx: Prisma.TransactionClient, request: FastifyRequest, assets: Asset[], components: ComponentInput[], operationId: string) {
  if (!assets.length) fail(400, 'Selecione pelo menos um ativo.');
  const poolId = assets[0].poolId;
  if (assets.some(a => a.poolId !== poolId)) fail(400, 'Selecione ativos de um único Pool por lote.');
  if (assets.some(a => ['DISPOSED', 'SOLD', 'LOST', 'INACTIVE'].includes(a.status))) fail(400, 'Não é permitido instalar componentes em ativos baixados, vendidos, extraviados ou inativos.');
  await writablePool(request, poolId, tx);
  const installed: string[] = [];
  for (const part of components) {
    const profile = await tx.itemProfile.findFirst({ where: { id: part.profileId, ...poolScope(request) } });
    if (!profile || !profile.active || profile.poolId !== poolId) fail(400, 'O perfil precisa estar ativo e pertencer ao mesmo Pool dos ativos.');
    const total = quantityForBatch(part.quantity, assets.length);
    if (part.origin === ComponentOrigin.FROM_STOCK && profile.availableQty < total) fail(409, `Estoque insuficiente para "${profile.name}": necessárias ${total} unidade(s), disponíveis ${profile.availableQty}.`);
    afterInstall(profile.availableQty, 0, total, part.origin);
    for (const asset of assets) {
      if (part.origin === ComponentOrigin.FROM_STOCK) {
        const changed = await tx.itemProfile.updateMany({ where: { id: profile.id, availableQty: { gte: part.quantity } }, data: { availableQty: { decrement: part.quantity } } });
        if (changed.count !== 1) fail(409, 'O estoque mudou. Analise o lote novamente.');
      }
      const current = await tx.itemProfile.findUniqueOrThrow({ where: { id: profile.id } });
      const component = await tx.assetComponent.create({ data: { assetId: asset.id, profileId: profile.id, quantity: part.quantity, origin: part.origin } });
      installed.push(component.id);
      await tx.stockMovement.create({ data: {
        profileId: profile.id, assetId: asset.id, operationId, userId: request.user.sub,
        type: part.origin === ComponentOrigin.FROM_STOCK ? StockMovementType.INSTALL_FROM_STOCK : StockMovementType.REGISTER_INSTALLED,
        quantity: part.quantity, availableAfter: current.availableQty,
      } });
    }
  }
  await audit(request, 'INSTALL_COMPONENTS', 'AssetComponent', operationId, undefined, { assetIds: assets.map(a => a.id), components }, tx);
  return installed;
}

export async function ensureFolderPath(tx: Prisma.TransactionClient, poolId: string, path?: string) {
  if (!path?.trim()) return null;
  const parts = path.replace(/\\/g, '/').split('/').map(s => s.trim());
  if (parts.length > 12 || parts.some(p => !p || p === '.' || p === '..' || p.length > 100)) fail(400, 'Caminho de pasta inválido. Use até 12 níveis separados por /.');
  let parentId: string | null = null;
  for (const name of parts) {
    const folders: Folder[] = await tx.folder.findMany({ where: { poolId, parentId, name }, take: 2 });
    if (folders.length > 1) fail(409, `Pasta ambígua: ${name}. Corrija as pastas duplicadas.`);
    const folder: Folder = folders[0] ?? await tx.folder.create({ data: { poolId, parentId, name } });
    parentId = folder.id;
  }
  return parentId;
}
