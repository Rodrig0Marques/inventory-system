import type { Prisma } from '@prisma/client';

export async function nextNonPatrimonialCode(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('inventory-non-patrimonial-sequence'))`;
  const counter = await tx.systemCounter.upsert({
    where: { key: 'NON_PATRIMONIAL_SEQUENCE' },
    create: { key: 'NON_PATRIMONIAL_SEQUENCE', value: 1 },
    update: { value: { increment: 1 } },
  });
  return `NP-${String(counter.value).padStart(6, '0')}`;
}
