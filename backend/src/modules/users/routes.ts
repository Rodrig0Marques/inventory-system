import type { FastifyInstance } from 'fastify';
import { PermissionCode, UserRole, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';
import { fail } from '../../utils/access.js';
import { serial } from '../../utils/transaction.js';
import { defaultPermissionsForRole, effectivePermissions } from '../../utils/permissions.js';

const select = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  canGlobalAssetLookup: true,
  canGlobalDashboardStats: true,
  permissionsInitialized: true,
  createdAt: true,
  updatedAt: true,
  permissions: { select: { permission: true } },
  poolAccess: { select: { poolId: true, pool: { select: { name: true, active: true } } } },
} as const;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof select }>;

const password = z.string().min(8, 'Use pelo menos 8 caracteres.').refine(s => Buffer.byteLength(s, 'utf8') <= 72, 'Use até 72 bytes na senha.');
const permissionList = z.array(z.nativeEnum(PermissionCode)).max(100);
const fields = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(254),
  role: z.nativeEnum(UserRole),
  active: z.boolean(),
  permissions: permissionList,
  poolIds: z.array(z.string().min(1)).max(500),
});

function normalizePermissions(values: PermissionCode[]) {
  return [...new Set(values)];
}

function serialize(user: SelectedUser) {
  const permissions = effectivePermissions(
    user.role,
    user.permissions.map(item => item.permission),
    user,
  );
  const { permissions: _storedPermissions, permissionsInitialized: _initialized, ...base } = user;
  return {
    ...base,
    permissions,
    canGlobalAssetLookup: permissions.includes(PermissionCode.GLOBAL_ASSET_LOOKUP),
    canGlobalDashboardStats: permissions.includes(PermissionCode.GLOBAL_DASHBOARD_STATS),
  };
}

async function checkPools(tx: Prisma.TransactionClient, ids: string[]) {
  const unique = [...new Set(ids)];
  if (await tx.pool.count({ where: { id: { in: unique } } }) !== unique.length) fail(400, 'Um dos Setores selecionados não existe.');
  return unique;
}

export async function userRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);
  // A gestão de contas continua reservada ao ADMIN. As permissões granulares
  // controlam ações operacionais, sem permitir escalada de privilégios.
  app.addHook('preHandler', app.authorize([UserRole.ADMIN]));

  app.get('/', async () => {
    const users = await prisma.user.findMany({ select, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return users.map(serialize);
  });

  app.post('/', async (request, reply) => {
    const data = fields.extend({
      password,
      role: fields.shape.role.default(UserRole.VIEWER),
      active: z.boolean().default(true),
      permissions: permissionList.optional(),
      poolIds: fields.shape.poolIds.default([]),
    }).parse(request.body);

    const hash = await bcrypt.hash(data.password, 10);
    const user = await serial(async tx => {
      const poolIds = await checkPools(tx, data.poolIds);
      const permissions = data.role === UserRole.ADMIN
        ? []
        : normalizePermissions(data.permissions ?? defaultPermissionsForRole(data.role));

      const result = await tx.user.create({
        data: {
          name: data.name,
          email: data.email.toLowerCase(),
          password: hash,
          role: data.role,
          active: data.active,
          permissionsInitialized: true,
          canGlobalAssetLookup: permissions.includes(PermissionCode.GLOBAL_ASSET_LOOKUP),
          canGlobalDashboardStats: permissions.includes(PermissionCode.GLOBAL_DASHBOARD_STATS),
          permissions: { create: permissions.map(permission => ({ permission })) },
          poolAccess: { create: (data.role === UserRole.ADMIN ? [] : poolIds).map(poolId => ({ poolId })) },
        },
        select,
      });
      await audit(request, 'CREATE', 'User', result.id, undefined, serialize(result), tx);
      return result;
    });

    return reply.status(201).send(serialize(user));
  });

  app.put('/:id', async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const data = fields.partial().parse(request.body);

    return serial(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('inventory-admins'))`;
      const actor = await tx.user.findUnique({ where: { id: request.user.sub } });
      if (!actor?.active || actor.role !== UserRole.ADMIN) fail(403, 'Permissão administrativa revogada.');

      const current = await tx.user.findUnique({ where: { id }, select });
      if (!current) fail(404, 'Usuário não encontrado.');

      if (id === request.user.sub && (data.active === false || (data.role && data.role !== UserRole.ADMIN))) {
        fail(400, 'Você não pode desativar ou remover o próprio perfil administrativo.');
      }

      const role = data.role ?? current.role;
      if (
        current.role === UserRole.ADMIN &&
        current.active &&
        (role !== UserRole.ADMIN || data.active === false) &&
        !await tx.user.count({ where: { id: { not: id }, role: UserRole.ADMIN, active: true } })
      ) {
        fail(409, 'Mantenha pelo menos um administrador ativo.');
      }

      const { poolIds, permissions: requestedPermissions, ...base } = data;
      const ids = poolIds === undefined ? undefined : await checkPools(tx, poolIds);

      const currentStoredPermissions = current.permissions.map(item => item.permission);
      const permissions = role === UserRole.ADMIN
        ? []
        : normalizePermissions(
            requestedPermissions ??
            (data.role && data.role !== current.role ? defaultPermissionsForRole(role) : currentStoredPermissions),
          );

      if (ids !== undefined || role === UserRole.ADMIN) {
        await tx.userPool.deleteMany({ where: { userId: id } });
      }

      const updatedBase = await tx.user.update({
        where: { id },
        data: {
          ...base,
          ...(base.email ? { email: base.email.toLowerCase() } : {}),
          permissionsInitialized: true,
          canGlobalAssetLookup: permissions.includes(PermissionCode.GLOBAL_ASSET_LOOKUP),
          canGlobalDashboardStats: permissions.includes(PermissionCode.GLOBAL_DASHBOARD_STATS),
          ...(role !== UserRole.ADMIN && ids !== undefined
            ? { poolAccess: { create: ids.map(poolId => ({ poolId })) } }
            : {}),
        },
      });

      if (role === UserRole.ADMIN || requestedPermissions !== undefined || (data.role && data.role !== current.role)) {
        await tx.userPermission.deleteMany({ where: { userId: id } });
        if (role !== UserRole.ADMIN && permissions.length) {
          await tx.userPermission.createMany({ data: permissions.map(permission => ({ userId: id, permission })) });
        }
      }

      const updated = await tx.user.findUniqueOrThrow({ where: { id: updatedBase.id }, select });
      await audit(request, 'UPDATE', 'User', id, serialize(current), serialize(updated), tx);
      return serialize(updated);
    });
  });

  app.put('/:id/password', async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ password }).parse(request.body);
    const hash = await bcrypt.hash(body.password, 10);
    await serial(async tx => {
      await tx.user.update({ where: { id }, data: { password: hash, tokenVersion: { increment: 1 } } });
      await audit(request, 'RESET_PASSWORD', 'User', id, undefined, { sessionsRevoked: true }, tx);
    });
    return { message: 'Senha alterada e sessões anteriores revogadas.' };
  });

  app.delete('/:id', async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    if (id === request.user.sub) fail(400, 'Você não pode excluir o próprio usuário.');

    return serial(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('inventory-admins'))`;
      const actor = await tx.user.findUnique({ where: { id: request.user.sub } });
      if (!actor?.active || actor.role !== UserRole.ADMIN) fail(403, 'Permissão administrativa revogada.');
      const current = await tx.user.findUnique({ where: { id }, select });
      if (!current) fail(404, 'Usuário não encontrado.');
      if (
        current.role === UserRole.ADMIN &&
        current.active &&
        !await tx.user.count({ where: { id: { not: id }, role: UserRole.ADMIN, active: true } })
      ) {
        fail(409, 'Mantenha um administrador ativo.');
      }
      await tx.user.delete({ where: { id } });
      await audit(request, 'DELETE', 'User', id, serialize(current), undefined, tx);
      return { message: 'Usuário excluído.' };
    });
  });
}
