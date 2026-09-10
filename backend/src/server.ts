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
import { userRoutes } from './modules/users/routes.js';

const app = Fastify({ logger: true });

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

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);

  const statusCode =
    error instanceof ZodError
      ? 400
      : typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;

  const message = error instanceof Error ? error.message : 'Erro interno do servidor.';

  reply.status(statusCode).send({
    message,
    ...(error instanceof ZodError ? { issues: error.issues } : {}),
  });
});

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 3333) });
