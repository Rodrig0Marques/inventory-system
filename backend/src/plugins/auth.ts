import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { prisma } from './prisma.js';

type AuthUser = {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (roles: UserRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app) => {
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'change-me-in-production' });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();

      const databaseUser = await prisma.user.findUnique({
        where: { id: request.user.sub },
        select: { active: true, role: true },
      });

      if (!databaseUser?.active) {
        reply.status(401).send({ message: 'Usuário inativo ou não encontrado.' });
        return;
      }

      // Se o perfil foi alterado, força um novo login para renovar o JWT.
      if (databaseUser.role !== request.user.role) {
        reply.status(401).send({ message: 'Seu perfil de acesso foi alterado. Entre novamente no sistema.' });
        return;
      }
    } catch {
      if (!reply.sent) {
        reply.status(401).send({ message: 'Não autorizado.' });
        return;
      }
    }
  });

  app.decorate('authorize', (roles: UserRole[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user || !roles.includes(request.user.role)) {
        reply.status(403).send({ message: 'Você não possui permissão para executar esta ação.' });
        return;
      }
    };
  });
});
