# CONTEXTO — INVENTORY SYSTEM v7.5

Data: 2026-09-18

Use este arquivo como contexto inicial no ChatGPT Desktop para continuar o desenvolvimento do projeto.

## Projeto

Sistema interno de inventário/gestão patrimonial.

Stack:
- Backend: Node.js 22, TypeScript 5.9.x, Fastify 5, Prisma 6
- Banco: PostgreSQL 15
- Frontend: Next.js 15, React 19
- Infra: Docker Compose

Produção:
- Projeto: `/home/ciadocredito/inventory-system`
- Backend: porta 3333
- Frontend: porta 4500

Desenvolvimento Windows:
- Projeto: `D:\inventory-system`
- Frontend: 3000
- Backend: 3333

Git:
- Repo: `Rodrig0Marques/inventory-system`
- Branch: `main`

Regra crítica:
NUNCA executar `docker compose down -v`, `docker volume rm` ou `prisma migrate reset` no banco real.

---

## Conceito atual

### Ativos
Patrimônios principais e controlados individualmente:
- notebook
- desktop
- monitor com patrimônio
- cadeira
- transformador
- veículo
- ar-condicionado

A aba **Ativos** deve ser a tela principal para consultar patrimônios.

### Estoque e componentes
Itens/componentes mantidos em saldo, instalados ou baixados:
- memória RAM
- SSD
- fonte
- cabos
- peças de reposição
- periféricos sem patrimônio próprio

A aba **Estoque e componentes** não deve ser usada como listagem principal de patrimônios.

### Pools
Agrupamentos/setores/unidades:
- RH
- TI
- Administrativo
- ALN Almenara

Um Pool pode possuir ativos, pastas e componentes.

---

## UX definida para v7.5

### Ativos
Adicionar filtros:
- busca por patrimônio/nome
- Pool
- Categoria
- Status
- limpar filtros

Backend já suporta:
`/assets?search=...`
`/assets?poolId=...`
`/assets?categoryId=...`
`/assets?status=AVAILABLE`

Filtros podem ser combinados.

O badge/nome do Pool na lista pode levar para:
`/assets?poolId=<poolId>`

### Pools
Separar ações:
- `Ver ativos` → `/assets?poolId=<id>`
- `Ver estoque` → `/stock?poolId=<id>`

Evitar que o nome da Pool leve apenas para estoque.

Foi prevista/adicionada uma página:
`/pools/[id]`

### Estoque e componentes
Foco em:
- perfis de componentes
- saldos
- entradas
- baixas
- componentes instalados
- associação a ativos
- movimentações

---

## Permissões granulares v7.5

Antes o sistema dependia principalmente de:
- ADMIN
- MANAGER
- VIEWER

Agora o objetivo é permitir exceções específicas por usuário.

Separar:

ESCOPO = onde o usuário enxerga  
PERMISSÃO = o que o usuário pode fazer

### Escopo
Continua controlado por `UserPool`.

Exemplo:
Usuário RH → Pool RH

### PermissionCode

```prisma
enum PermissionCode {
  GLOBAL_ASSET_LOOKUP
  GLOBAL_DASHBOARD_STATS

  ASSET_CREATE
  ASSET_EDIT
  ASSET_MOVE
  ASSET_DELETE
  IMPORT_ASSETS

  POOL_CREATE
  POOL_EDIT
  POOL_DELETE

  CATEGORY_CREATE
  CATEGORY_EDIT
  CATEGORY_DELETE

  FOLDER_CREATE
  FOLDER_DELETE

  STOCK_MANAGE

  USER_MANAGE
}
```

### UserPermission

```prisma
model UserPermission {
  id         String         @id @default(cuid())
  userId     String
  permission PermissionCode

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, permission])
  @@index([userId])
}
```

No User:
```prisma
permissions UserPermission[]
permissionsInitialized Boolean @default(false)
```

Compatibilidade temporária:
```prisma
canGlobalAssetLookup Boolean @default(false)
canGlobalDashboardStats Boolean @default(false)
```

ADMIN continua implicitamente global.

Exemplo:
```text
Perfil: VIEWER
Pool: RH

[x] GLOBAL_ASSET_LOOKUP
[x] GLOBAL_DASHBOARD_STATS
[x] ASSET_CREATE
[x] ASSET_EDIT
[ ] ASSET_DELETE
[ ] STOCK_MANAGE
```

Exemplo de criação de Pool:
```text
VIEWER
[x] POOL_CREATE
[ ] POOL_EDIT
[ ] POOL_DELETE
```

Se um não-ADMIN criar um Pool, conceder automaticamente acesso a ele via `UserPool`.

---

## Consulta global por patrimônio

Permissão:
`GLOBAL_ASSET_LOOKUP`

Endpoint:
`GET /assets/global-lookup`

Agora deve aceitar até 50 patrimônios.

Formatos:
```text
C5478,c0025,c2374
```

```text
C5478;c0025;c2374
```

ou um por linha.

Regras:
- máximo 50
- busca exata
- case-insensitive
- sem listagem global irrestrita
- retorna itens encontrados e `notFound`
- grava auditoria `GLOBAL_ASSET_LOOKUP`

Retorno esperado:
```json
{
  "items": [],
  "requestedCount": 3,
  "resultCount": 2,
  "notFound": ["ABC999"]
}
```

Busca principal:
```ts
const items = await prisma.asset.findMany({
  where: {
    OR: patrimonies.map(patrimony => ({
      patrimonyNumber: {
        equals: patrimony,
        mode: 'insensitive',
      },
    })),
  },
});
```

---

## Dashboard global

Permissão:
`GLOBAL_DASHBOARD_STATS`

Quando habilitada, devem ser globais:
- Total de ativos
- Valor patrimonial
- Em uso
- Disponíveis
- contador circular de ativos

Continuam escopados:
- distribuição por Pool
- categorias
- lista normal de ativos
- estoque/componentes

Implementação correta em:
`backend/src/modules/assets/routes.ts`

```ts
const scopedWhere: Prisma.AssetWhereInput = poolScope(request);

const dashboardWhere: Prisma.AssetWhereInput =
  request.canGlobalDashboardStats ? {} : scopedWhere;

const totalQuery = prisma.asset.count({
  where: dashboardWhere,
});

const byStatusQuery = prisma.asset.groupBy({
  by: ['status'],
  where: dashboardWhere,
  orderBy: { status: 'asc' },
  _count: { _all: true },
});

const valueQuery = prisma.asset.aggregate({
  where: dashboardWhere,
  _sum: { purchasePrice: true },
});
```

Bug encontrado:
o source estava correto, mas o container tinha `dist` antigo usando:
`valueQuery -> scopedWhere`

Isso fazia:
```json
{
  "total": 5,
  "totalValue": 0,
  "countsAreGlobal": true
}
```

No banco:
```text
total = 5
valor_patrimonial = 10499.90
```

Diagnóstico:
```bash
docker compose exec backend sh -c "grep -nE 'countsWhere|dashboardWhere|scopedWhere|purchasePrice|countsAreGlobal' /app/dist/src/modules/assets/routes.js | head -40"
```

Correto:
- total usa `dashboardWhere`
- status usa `dashboardWhere`
- valor usa `dashboardWhere`

---

## ALN Almenara

Ativos como:
- C0590
- C0591
- C0592
- C0593
- C0594
- C0595

aparecem com Pool `ALN Almenara`.

A confusão provável era UX:
clicar na Pool levava para `/stock?poolId=...`, não para uma lista de ativos.

SQL para confirmar:
```sql
SELECT
    p.id,
    p.name,
    p.active,
    COUNT(a.id) AS ativos
FROM "Pool" p
LEFT JOIN "Asset" a
    ON a."poolId" = p.id
WHERE
    p.name ILIKE '%ALN%'
    OR p.name ILIKE '%Almenara%'
GROUP BY
    p.id,
    p.name,
    p.active
ORDER BY p.name, p.id;
```

Isso também detecta Pools duplicados.

Confirmar patrimônios:
```sql
SELECT
    a."patrimonyNumber",
    a.name,
    a."poolId",
    p.name AS pool
FROM "Asset" a
INNER JOIN "Pool" p
    ON p.id = a."poolId"
WHERE a."patrimonyNumber" IN (
    'C0590','C0591','C0592','C0593','C0594','C0595'
)
ORDER BY a."patrimonyNumber";
```

---

## Importação e Cloudflare

Frontend:
`https://inventario.conquesthub.com.br`

API:
`https://api-inventario.conquesthub.com.br`

Variável correta:
```env
NEXT_PUBLIC_API_URL=https://api-inventario.conquesthub.com.br
```

Nunca deixar `http://localhost:3333` embutido no bundle de produção.

### Cloudflare
Upload Excel em:
`POST /imports/assets/preview`

O preflight OPTIONS chegava ao backend, mas o POST era bloqueado antes do Fastify.

Regra identificada:
`949110: Inbound Anomaly Score Exceeded`

Cloudflare:
- Managed Rules / OWASP
- Edge status 403
- Origin status none

Foi definida regra `Skip/Ignorar` somente para:
- Host: `api-inventario.conquesthub.com.br`
- Method: POST
- `/imports/assets/preview`
- `/imports/assets`

Expressão:
```text
(http.host eq "api-inventario.conquesthub.com.br"
 and http.request.method eq "POST"
 and (
   http.request.uri.path eq "/imports/assets/preview"
   or
   http.request.uri.path eq "/imports/assets"
 ))
```

Na ação Ignorar, marcar somente:
`Todas as regras gerenciadas`

Não ignorar sem necessidade:
- regras personalizadas
- Rate Limiting
- Super Bot Fight

---

## Importador

Aceita:
- CSV
- XLS
- XLSX
- XML

Colunas:
```text
patrimonio
nome
pool
categoria
descricao
fabricante
modelo
preco
localizacao
responsavel
```

Regras:
- Pool inválido rejeita linha
- Categoria inválida rejeita linha
- não cria Pool/Categoria automaticamente
- mesmo patrimônio + Pool existente atualiza
- novo cria
- linhas inválidas não são gravadas

Melhoria sugerida:
mostrar `Preço` também no preview da importação.

---

## Arquivos principais

Backend:
```text
backend/prisma/schema.prisma
backend/src/plugins/auth.ts
backend/src/modules/auth/routes.ts
backend/src/modules/users/routes.ts
backend/src/modules/assets/routes.ts
backend/src/modules/pools/routes.ts
backend/src/modules/categories/routes.ts
backend/src/modules/folders/routes.ts
backend/src/modules/imports/routes.ts
backend/src/modules/stock/routes.ts
backend/src/utils/access.ts
```

Frontend:
```text
frontend/app/page.tsx
frontend/app/assets/page.tsx
frontend/app/assets/[id]/page.tsx
frontend/app/assets/[id]/edit/page.tsx
frontend/app/pools/page.tsx
frontend/app/pools/[id]/page.tsx
frontend/app/stock/page.tsx
frontend/app/structure/page.tsx
frontend/app/imports/page.tsx
frontend/app/users/page.tsx
frontend/app/globals.css
frontend/lib/session.ts
```

---

## Artefato v7.5

Arquivo:
`inventory-ui-permissions-v7.5.zip`

SHA-256:
```text
1941393e2c57f14f9d106ba215dfaf4f28db9913123044694bb6d7a5f971d406
```

Inclui:
```text
README-V7.5.md
docs/PERMISSOES_V7.5.md
MANIFESTO-V7.5.json
```

O pacote não deve sobrescrever `.env` ou `docker-compose.yml` sem revisão.

---

## Deploy recomendado

Backup:
```bash
cd /home/ciadocredito/inventory-system

docker compose exec -T db   pg_dump -U inventory inventory   > backup_before_v7_5_$(date +%Y%m%d_%H%M%S).sql
```

Build:
```bash
docker compose build --no-cache backend frontend
```

Subir:
```bash
docker compose up -d   --no-deps   --force-recreate backend frontend
```

Validar:
```bash
docker compose ps
docker compose logs --tail=150 backend
curl -i http://localhost:3333/health
```

Depois de alteração de autenticação/permissões:
fazer logout/login novamente.

---

## Pontos a validar

1. Build completo backend/frontend no ambiente real.
2. Seed/migração de permissões sem duplicar registros.
3. MANAGER antigos mantendo capacidades esperadas.
4. VIEWER + permissões isoladas funcionando.
5. Pool criado por não-ADMIN recebe UserPool automaticamente.
6. `POOL_CREATE` não implica `POOL_EDIT`/`POOL_DELETE`.
7. `ASSET_EDIT` não implica `ASSET_DELETE`.
8. Backend bloqueia ações sem permissão, não apenas a UI.
9. Consulta global múltipla retorna `notFound`.
10. Verificar Pool duplicado `ALN Almenara`.
11. Frontend de produção sem `localhost:3333`.
12. Texto do Dashboard informando que Valor patrimonial também é global quando autorizado.

---

## Instrução para o próximo ChatGPT

Use este documento como contexto principal.

Estado desejado:
- Ativos e Estoque separados conceitualmente
- filtro por Pool em Ativos
- Pools com `Ver ativos` e `Ver estoque`
- permissões granulares
- UserPool continua controlando escopo
- ADMIN permanece global
- consulta global aceita múltiplos patrimônios
- Dashboard global inclui total, valor, em uso e disponíveis
- deploy sem destruir volumes
- preservar `.env`/Compose de produção
- frontend de produção usa `https://api-inventario.conquesthub.com.br`

Ao propor mudanças, fornecer arquivos/comandos concretos e preservar compatibilidade com o ambiente atual.
