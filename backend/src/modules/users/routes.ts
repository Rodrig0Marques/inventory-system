import type { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { audit } from '../../utils/audit.js';

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do usuário.'),
  email: z.string().trim().email('Informe um e-mail válido.'),
  password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.'),
  role: z.nativeEnum(UserRole).default(UserRole.VIEWER),
  active: z.boolean().default(true),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).optional(),
  email: z.string().trim().email().optional(),
  role: z.nativeEnum(UserRole).optional(),
  active: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'Informe ao menos um campo para alteração.' });

async function hasAnotherActiveAdmin(userId: string) {
  const count = await prisma.user.count({
    where: { id: { not: userId }, role: UserRole.ADMIN, active: true },
  });
  return count > 0;
}

export async function userRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', app.authorize([UserRole.ADMIN]));

  app.get('/', async () => {
    return prisma.user.findMany({
      select: userSelect,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  });

  app.post('/', async (request, reply) => {
    const data = createUserSchema.parse(request.body);
    const email = data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      return reply.status(409).send({ message: 'Já existe um usuário cadastrado com esse e-mail.' });
    }

    const password = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email,
        password,
        role: data.role,
        active: data.active,
      },
      select: userSelect,
    });

    await audit(request, 'CREATE', 'User', user.id, undefined, user);
    return reply.status(201).send(user);
  });

  app.put('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const data = updateUserSchema.parse(request.body);
    const current = await prisma.user.findUnique({ where: { id }, select: userSelect });

    if (!current) return reply.status(404).send({ message: 'Usuário não encontrado.' });

    const isSelf = request.user.sub === id;
    if (isSelf && data.active === false) {
      return reply.status(400).send({ message: 'Você não pode desativar o próprio usuário.' });
    }
    if (isSelf && data.role && data.role !== UserRole.ADMIN) {
      return reply.status(400).send({ message: 'Você não pode remover o próprio perfil de administrador.' });
    }

    const removingLastAdmin = current.role === UserRole.ADMIN && current.active && (
      (data.role !== undefined && data.role !== UserRole.ADMIN) || data.active === false
    );
    if (removingLastAdmin && !(await hasAnotherActiveAdmin(id))) {
      return reply.status(409).send({ message: 'É necessário manter pelo menos um administrador ativo no sistema.' });
    }

    const email = data.email?.toLowerCase();
    if (email && email !== current.email) {
      const emailOwner = await prisma.user.findUnique({ where: { email } });
      if (emailOwner && emailOwner.id !== id) {
        return reply.status(409).send({ message: 'Esse e-mail já está sendo utilizado por outro usuário.' });
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { ...data, ...(email ? { email } : {}) },
      select: userSelect,
    });

    await audit(request, 'UPDATE', 'User', id, current, updated);
    return updated;
  });

  app.put('/:id/password', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { password } = z.object({
      password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.'),
    }).parse(request.body);

    const current = await prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!current) return reply.status(404).send({ message: 'Usuário não encontrado.' });

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id }, data: { password: passwordHash } });
    await audit(request, 'RESET_PASSWORD', 'User', id, undefined, { userId: id });

    return reply.send({ message: `Senha de ${current.name} alterada com sucesso.` });
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    if (request.user.sub === id) {
      return reply.status(400).send({ message: 'Você não pode excluir o próprio usuário.' });
    }

    const current = await prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!current) return reply.status(404).send({ message: 'Usuário não encontrado.' });

    if (current.role === UserRole.ADMIN && current.active && !(await hasAnotherActiveAdmin(id))) {
      return reply.status(409).send({ message: 'É necessário manter pelo menos um administrador ativo no sistema.' });
    }

    await prisma.user.delete({ where: { id } });
    await audit(request, 'DELETE', 'User', id, current, undefined);

    return reply.send({ message: 'Usuário excluído com sucesso.' });
  });
}
