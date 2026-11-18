import type { ItemProfile, Prisma } from '@prisma/client';
import { fail } from '../../utils/access.js';

// Both installed and available units must resolve to the same compatible profile.
export async function resolveTransferProfile(tx: Prisma.TransactionClient, source: ItemProfile, toPoolId: string) {
  const destination = await tx.itemProfile.findUnique({ where: { poolId_name: { poolId: toPoolId, name: source.name } } });
  if (destination) {
    if (!destination.active) fail(409, `Reative o perfil "${source.name}" no Setor de destino antes de transferir.`);
    if (destination.categoryId !== source.categoryId || (['manufacturer', 'model', 'specifications'] as const).some(key => (destination[key] || '') !== (source[key] || ''))) {
      fail(409, `O perfil "${source.name}" no destino possui especificações diferentes. Renomeie ou ajuste o perfil antes da transferência.`);
    }
    return destination;
  }
  return tx.itemProfile.create({ data: { poolId: toPoolId, categoryId: source.categoryId, name: source.name, description: source.description, manufacturer: source.manufacturer, model: source.model, specifications: source.specifications, availableQty: 0 } });
}
