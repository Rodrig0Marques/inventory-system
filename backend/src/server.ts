import { buildApp } from './app.js';
import { prisma } from './plugins/prisma.js';
const app = await buildApp();
const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 3333) });
