import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { UserRole } from '@prisma/client';

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const body = z.object({
      email: z.string().trim().email(),
      password: z.string().min(1),
    }).parse(request.body);

    const email = body.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.active || !(await bcrypt.compare(body.password, user.password))) {
      return reply.status(401).send({ message: 'Credenciais inválidas.' });
    }

    const publicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      canGlobalAssetLookup: user.role === UserRole.ADMIN || user.canGlobalAssetLookup,
    };

    const token = app.jwt.sign(
      { sub: user.id, email: user.email, name: user.name, role: user.role, tokenVersion: user.tokenVersion },
      { expiresIn: '8h' },
    );

    return { token, user: publicUser };
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { id: true, name: true, email: true, role: true, active: true, canGlobalAssetLookup: true },
    });

    if (!user || !user.active) {
      return reply.status(401).send({ message: 'Usuário inativo ou não encontrado.' });
    }

    return { ...user, canGlobalAssetLookup: user.role === UserRole.ADMIN || user.canGlobalAssetLookup, poolIds: request.poolIds };
  });
}
