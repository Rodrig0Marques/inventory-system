import type { FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { fail } from '../../utils/access.js';
import { audit } from '../../utils/audit.js';
import { resolveTransferProfile } from '../stock/transfers.js';

// Called inside the same serializable transaction that moves the asset.
export async function transferInstalledComponents(tx: Prisma.TransactionClient, request: FastifyRequest, assetId: string, fromPoolId: string, toPoolId: string, operationId: string) {
  const components = await tx.assetComponent.findMany({ where: { assetId, removedAt: null }, include: { profile: true }, orderBy: { id: 'asc' } });
  for (const component of components) {
    const source = component.profile;
    if (source.poolId !== fromPoolId) fail(409, 'O componente não pertence ao Setor de origem do ativo.');
    const destination = await resolveTransferProfile(tx, source, toPoolId);
    await tx.assetComponent.update({ where: { id: component.id }, data: { removedAt: new Date() } });
    const installed = await tx.assetComponent.create({ data: { assetId, profileId: destination.id, quantity: component.quantity, origin: component.origin, installedAt: component.installedAt } });
    await tx.stockMovement.createMany({ data: [
      { profileId: source.id, assetId, userId: request.user.sub, operationId, type: 'TRANSFER_OUT', quantity: component.quantity, availableAfter: source.availableQty, notes: 'Componente transferido junto com o ativo.' },
      { profileId: destination.id, assetId, userId: request.user.sub, operationId, type: 'TRANSFER_IN', quantity: component.quantity, availableAfter: destination.availableQty, notes: 'Componente recebido junto com o ativo.' },
    ] });
    await audit(request, 'TRANSFER_COMPONENT', 'AssetComponent', installed.id, { componentId: component.id, poolId: fromPoolId, profileId: source.id }, { assetId, poolId: toPoolId, profileId: destination.id, quantity: component.quantity }, tx);
  }
}
