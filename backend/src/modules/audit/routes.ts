import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';

export async function auditRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', app.authorize(['ADMIN']));
  app.get('/', async request => {
    const q = z.object({ entity: z.string().max(100).optional(), entityId: z.string().max(200).optional(), userId: z.string().max(200).optional(), action: z.string().max(100).optional(), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const where: Prisma.AuditLogWhereInput = { entity: q.entity || undefined, entityId: q.entityId || undefined, userId: q.userId || undefined, action: q.action || undefined };
    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({ where, include: { user: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}
