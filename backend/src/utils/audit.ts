import type { FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../plugins/prisma.js';

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function audit(request: FastifyRequest, action: string, entity: string, entityId?: string, oldValue?: unknown, newValue?: unknown, db: Prisma.TransactionClient = prisma) {
  const user = request.user as { sub?: string } | undefined;
  await db.auditLog.create({
    data: {
      userId: user?.sub,
      action,
      entity,
      entityId,
      oldValue: toJson(oldValue),
      newValue: toJson(newValue),
      ip: request.ip,
    },
  });
}
