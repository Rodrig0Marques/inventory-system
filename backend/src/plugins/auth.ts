import fp from 'fastify-plugin';
import { jwtSecret } from '../utils/secret.js';
import jwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PermissionCode, UserRole } from '@prisma/client';
import { prisma } from './prisma.js';
import { effectivePermissions } from '../utils/permissions.js';

type AuthUser = {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  tokenVersion?: number;
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    poolIds: string[] | null;
    assignedPoolIds: string[] | null;
    permissions: PermissionCode[];
    canGlobalAssetLookup: boolean;
    canGlobalDashboardStats: boolean;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (roles: UserRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (permission: PermissionCode) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app) => {
  await app.register(jwt, { secret: jwtSecret(process.env.JWT_SECRET) });

  app.decorateRequest('poolIds', null);
  app.decorateRequest('assignedPoolIds', null);
  app.decorateRequest('permissions');
  app.decorateRequest('canGlobalAssetLookup', false);
  app.decorateRequest('canGlobalDashboardStats', false);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();

      const databaseUser = await prisma.user.findUnique({
        where: { id: request.user.sub },
        select: {
          active: true,
          role: true,
          tokenVersion: true,
          canGlobalAssetLookup: true,
          canGlobalDashboardStats: true,
          permissions: { select: { permission: true } },
          poolAccess: { select: { poolId: true, pool: { select: { active: true } } } },
        },
      });

      if (!databaseUser?.active) {
        reply.status(401).send({ message: 'Usuário inativo ou não encontrado.' });
        return;
      }

      // Se o perfil foi alterado, força um novo login para renovar o JWT.
      if (databaseUser.role !== request.user.role || databaseUser.tokenVersion !== (request.user.tokenVersion ?? 0)) {
        reply.status(401).send({ message: 'Seu perfil de acesso foi alterado. Entre novamente no sistema.' });
        return;
      }

      request.assignedPoolIds = databaseUser.role === UserRole.ADMIN ? null : databaseUser.poolAccess.map(p => p.poolId);
      request.poolIds = databaseUser.role === UserRole.ADMIN
        ? null
        : databaseUser.poolAccess.filter(p => p.pool.active).map(p => p.poolId);
      request.permissions = effectivePermissions(
        databaseUser.role,
        databaseUser.permissions.map(item => item.permission),
        databaseUser,
      );
      request.canGlobalAssetLookup = request.permissions.includes(PermissionCode.GLOBAL_ASSET_LOOKUP);
      request.canGlobalDashboardStats = request.permissions.includes(PermissionCode.GLOBAL_DASHBOARD_STATS);
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

  app.decorate('requirePermission', (permission: PermissionCode) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user || !request.permissions.includes(permission)) {
        reply.status(403).send({ message: 'Você não possui permissão para executar esta ação.' });
        return;
      }
    };
  });
});
