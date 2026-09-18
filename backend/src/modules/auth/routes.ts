import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { PermissionCode, UserRole } from '@prisma/client';
import { effectivePermissions } from '../../utils/permissions.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const body = z.object({
      email: z
        .string({
          required_error: 'Informe o e-mail.',
          invalid_type_error: 'Informe o e-mail.',
        })
        .trim()
        .min(1, 'Informe o e-mail.')
        .email('Informe um e-mail válido.'),
      password: z
        .string({
          required_error: 'Informe a senha.',
          invalid_type_error: 'Informe a senha.',
        })
        .min(1, 'Informe a senha.'),
    }).parse(request.body);

    const email = body.email.toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      include: { permissions: { select: { permission: true } } },
    });

    if (!user || !user.active || !(await bcrypt.compare(body.password, user.password))) {
      return reply.status(401).send({ message: 'Credenciais inválidas.' });
    }

    const permissions = effectivePermissions(
      user.role,
      user.permissions.map(item => item.permission),
      user,
    );

    const publicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      permissions,
      canGlobalAssetLookup: permissions.includes(PermissionCode.GLOBAL_ASSET_LOOKUP),
      canGlobalDashboardStats: permissions.includes(PermissionCode.GLOBAL_DASHBOARD_STATS),
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
      select: { id: true, name: true, email: true, role: true, active: true },
    });

    if (!user || !user.active) {
      return reply.status(401).send({ message: 'Usuário inativo ou não encontrado.' });
    }

    return {
      ...user,
      permissions: request.permissions,
      canGlobalAssetLookup: request.permissions.includes(PermissionCode.GLOBAL_ASSET_LOOKUP),
      canGlobalDashboardStats: request.permissions.includes(PermissionCode.GLOBAL_DASHBOARD_STATS),
      poolIds: request.poolIds,
    };
  });
}
