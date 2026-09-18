import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import authPlugin from './plugins/auth.js';
import { prisma } from './plugins/prisma.js';
import { authRoutes } from './modules/auth/routes.js';
import { poolRoutes } from './modules/pools/routes.js';
import { folderRoutes } from './modules/folders/routes.js';
import { categoryRoutes } from './modules/categories/routes.js';
import { assetRoutes } from './modules/assets/routes.js';
import { importRoutes } from './modules/imports/routes.js';
import { stockRoutes } from './modules/stock/routes.js';
import { Prisma } from '@prisma/client';
import { userRoutes } from './modules/users/routes.js';

export async function buildApp(logger = true) {
const app = Fastify({ logger });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
await app.register(authPlugin);

app.get('/health', async () => ({ status: 'ok' }));
app.register(authRoutes, { prefix: '/auth' });
app.register(poolRoutes, { prefix: '/pools' });
app.register(folderRoutes, { prefix: '/folders' });
app.register(categoryRoutes, { prefix: '/categories' });
app.register(assetRoutes, { prefix: '/assets' });
app.register(importRoutes, { prefix: '/imports' });
app.register(userRoutes, { prefix: '/users' });
app.register(stockRoutes, { prefix: '/stock' });

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const conflict = ['P2002', 'P2003', 'P2034'].includes(error.code);
    return reply.status(error.code === 'P2025' ? 404 : conflict ? 409 : 500).send({ message: error.code === 'P2025' ? 'Registro não encontrado.' : conflict ? 'Conflito de dados. Verifique duplicidade, vínculos ou tente novamente.' : 'Falha ao processar os dados.' });
  }
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];

    return reply.status(400).send({
      message: firstIssue?.message || 'Dados inválidos.',
      issues: error.issues,
    });
  }

  const statusCode =
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;

  const message =
    statusCode >= 500
      ? 'Erro interno do servidor.'
      : error instanceof Error
        ? error.message
        : 'Requisição inválida.';

  return reply.status(statusCode).send({ message });
});


return app;
}
