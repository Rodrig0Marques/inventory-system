import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../plugins/prisma.js';
import { fail } from './access.js';

export async function serial<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1))); continue;
      }
      throw error;
    }
  }
}

export async function operation<T>(request: FastifyRequest, id: string, kind: string, input: unknown,
  authorize: (tx: Prisma.TransactionClient) => Promise<void>, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return serial(async tx => {
    await authorize(tx);
    // Transaction-scoped lock also serializes retries of the same operation ID.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${id}))`;
    const old = await tx.stockOperation.findUnique({ where: { id } });
    if (old) {
      if (old.userId !== request.user.sub || old.kind !== kind || old.inputHash !== inputHash) fail(409, 'Identificador já utilizado para outra operação.');
      return old.result as unknown as T;
    }
    const result = await work(tx);
    await tx.stockOperation.create({ data: { id, kind, inputHash, userId: request.user.sub, result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue } });
    return result;
  });
}
