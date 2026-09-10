# Inventory System v5

Sistema interno de gestão patrimonial para ativos de TI, RH, Administrativo e qualquer outro domínio da empresa.

## Novidades da v5

- Gerenciamento completo de usuários pela interface.
- Perfis de acesso `ADMIN`, `MANAGER` e `VIEWER`.
- Permissões validadas no backend e refletidas no frontend.
- Criação, edição, ativação, desativação e exclusão de usuários.
- Redefinição de senha por administrador.
- Proteção contra exclusão/desativação do próprio administrador.
- Proteção para manter pelo menos um administrador ativo.
- Usuários desativados perdem o acesso imediatamente.
- Mudança de perfil força novo login para renovar as permissões do token.
- Menu de Usuários visível somente para administradores.
- Interface revisada com acentuação correta em português.
- Usuários `VIEWER` recebem uma interface somente leitura.

## Perfis de acesso

| Perfil | Permissões |
| --- | --- |
| `ADMIN` | Acesso total, incluindo gerenciamento de usuários |
| `MANAGER` | Cria, altera e exclui ativos, pools, categorias, pastas e importações |
| `VIEWER` | Consulta dashboard, ativos, pools, estrutura e histórico de importações |

As permissões não dependem apenas do frontend. O backend retorna HTTP `403` caso um usuário tente executar uma ação sem permissão.

## Principais recursos

- Autenticação JWT com validade de 8 horas.
- Dashboard patrimonial.
- Criação e exclusão de Pools.
- Criação e exclusão de Categorias.
- Criação e exclusão de Pastas e Subpastas.
- Proteção contra exclusão de estruturas que ainda possuem ativos.
- Cadastro e exclusão de ativos.
- Organização por Pool, Pasta e Categoria.
- Cadastro simplificado com patrimônio, nome, descrição, fabricante, modelo, preço, localização e responsável.
- Importação em lote por CSV, XLS, XLSX e XML.
- Histórico de importações.
- Auditoria de criação, alteração, movimentação e exclusão.
- Frontend responsivo.
- Docker Compose com PostgreSQL 15, backend e frontend.

## Stack

- Node.js 22
- TypeScript 5.9
- Fastify 5
- Prisma 6
- PostgreSQL 15
- Next.js 15
- React 19
- Docker Compose

## Executar com Docker

Na raiz do projeto:

```bash
cp .env.example .env
docker compose up -d --build
```

No PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Acessos:

- Frontend: http://localhost:3000
- API: http://localhost:3333
- Health: http://localhost:3333/health
- PostgreSQL: localhost:5432

Usuário inicial de uma instalação nova:

```text
E-mail: admin@inventory.local
Senha:  admin123
```

O usuário inicial é criado somente quando a tabela de usuários está vazia. Depois que existem usuários no sistema, o seed não recria contas removidas.

Altere a senha inicial e o `JWT_SECRET` antes de colocar o sistema em produção.

## Gerenciamento de usuários

Entre como administrador e acesse:

```text
Usuários
```

É possível:

- criar usuário;
- alterar nome e e-mail;
- selecionar perfil;
- ativar ou desativar acesso;
- redefinir senha;
- excluir usuário.

Regras de segurança:

- um administrador não pode excluir a própria conta;
- um administrador não pode desativar a própria conta;
- um administrador não pode remover o próprio perfil `ADMIN`;
- deve existir pelo menos um administrador ativo;
- usuários inativos são bloqueados pelo backend mesmo que ainda possuam um JWT antigo.

## Estrutura do inventário

```text
POOL
  -> PASTA
      -> SUBPASTA
          -> ATIVO

CATEGORIA
  -> classifica o tipo geral do ativo
```

Exemplo:

```text
Pool: TI
Pasta: Hardware / Estoque
Categoria: Notebook
Patrimônio: PAT-00125
Nome: Dell Latitude 5450
```

## Exclusão segura

- Um Pool com ativos não pode ser excluído.
- Uma Categoria com ativos não pode ser excluída.
- Uma Pasta com ativos não pode ser excluída.
- Uma Pasta com subpastas não pode ser excluída.
- Um Pool sem ativos pode ser excluído; suas pastas vazias são removidas junto com ele.

As exclusões ficam registradas em `AuditLog`.

## Importação

Formatos aceitos:

- `.csv`
- `.xls`
- `.xlsx`
- `.xml`

Modelo simplificado:

```text
patrimonio
nome
descricao
fabricante
modelo
preco
localizacao
responsavel
```

O arquivo `modelo_importacao_ativos.xlsx` está na raiz e também fica disponível na tela de Importações.

O Pool e a Categoria do lote são selecionados na tela antes do envio.

Se já existir o mesmo patrimônio no mesmo Pool, a importação atualiza o registro existente.

## Endpoints principais

```text
POST   /auth/login
GET    /auth/me

GET    /users                 ADMIN
POST   /users                 ADMIN
PUT    /users/:id             ADMIN
PUT    /users/:id/password    ADMIN
DELETE /users/:id             ADMIN

GET    /pools                 TODOS
POST   /pools                 ADMIN, MANAGER
PUT    /pools/:id             ADMIN, MANAGER
DELETE /pools/:id             ADMIN, MANAGER

GET    /folders               TODOS
POST   /folders               ADMIN, MANAGER
DELETE /folders/:id           ADMIN, MANAGER

GET    /categories            TODOS
POST   /categories            ADMIN, MANAGER
DELETE /categories/:id        ADMIN, MANAGER
POST   /categories/:id/types  ADMIN, MANAGER
POST   /categories/:id/fields ADMIN, MANAGER

GET    /assets                TODOS
GET    /assets/summary        TODOS
GET    /assets/:id            TODOS
POST   /assets                ADMIN, MANAGER
PUT    /assets/:id            ADMIN, MANAGER
DELETE /assets/:id            ADMIN, MANAGER
POST   /assets/:id/move       ADMIN, MANAGER

GET    /imports               TODOS
POST   /imports/assets        ADMIN, MANAGER
```

Todos os endpoints, exceto `/health` e `/auth/login`, exigem:

```text
Authorization: Bearer <token>
```

## Atualizar uma instalação v4

A v5 reutiliza o modelo de usuário que já existia na v4, portanto não exige apagar o banco.

```powershell
docker compose down
docker compose build --no-cache
docker compose up -d
```

Depois confira:

```powershell
docker compose ps
docker compose logs -f backend
```

Não use:

```powershell
docker compose down -v
```

se quiser manter os dados do PostgreSQL.

## Desenvolvimento sem Docker

Backend:

```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run seed
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```
