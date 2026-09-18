# Inventory System v7.5

Sistema corporativo de inventario e gestao patrimonial com separacao entre **Ativos** e **Estoque/Componentes**, controle por Pool e permissoes granulares por usuario.

## Stack

- Node.js 22
- TypeScript 5.9
- Fastify 5
- Prisma 6
- PostgreSQL 15
- Next.js 15.5.25
- React 19
- Docker Compose

## Conceitos

### Ativos
Patrimonios principais e individualmente controlados, como notebooks, desktops, monitores, cadeiras, transformadores, veiculos e outros bens.

A tela **Ativos** e o ponto central para consulta e possui filtros por:

- busca textual;
- Pool;
- Categoria;
- Status.

### Estoque e componentes
Itens mantidos em saldo ou instalados em ativos, como memoria RAM, SSD, fontes, cabos e pecas de reposicao.

A tela **Estoque e componentes** concentra:

- perfis de componentes;
- saldo disponivel;
- unidades instaladas;
- entradas e baixas;
- associacao a ativos;
- historico de movimentacoes.

### Pools
Pools representam setores, unidades ou agrupamentos. Cada Pool pode possuir ativos, pastas e estoque.

Na interface existem caminhos independentes:

- **Ver ativos** -> `/assets?poolId=<id>`
- **Ver estoque** -> `/stock?poolId=<id>`
- **Detalhes** -> `/pools/<id>`

## Permissoes granulares

O Pool define **onde** o usuario pode atuar e a permissao define **o que** ele pode fazer.

Permissoes disponiveis:

```text
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
```

`ADMIN` possui acesso global. A administracao de usuarios continua exclusiva de ADMIN para evitar escalada de privilegios.

Um usuario nao-ADMIN com `POOL_CREATE` recebe automaticamente acesso ao Pool que criar.

## Consulta global por patrimonio

Usuarios com `GLOBAL_ASSET_LOOKUP` podem localizar ate 50 patrimonios exatos por consulta, separados por nova linha, virgula ou ponto e virgula.

Exemplo:

```text
C0595
C0594
C0593
```

A resposta informa os encontrados e tambem os codigos em `notFound`.

## Dashboard global

Com `GLOBAL_DASHBOARD_STATS`, estes indicadores consideram todos os Pools:

- Total de ativos
- Valor patrimonial
- Em uso
- Disponiveis

Distribuicao por Pool e categorias continuam seguindo o escopo normal do usuario.

## Instalacao local

Copie o exemplo de ambiente:

```bash
cp .env.example .env
```

Gere uma chave JWT:

```bash
openssl rand -hex 32
```

Coloque o valor em `JWT_SECRET` no `.env`.

Para desenvolvimento local, `NEXT_PUBLIC_API_URL` pode ser:

```env
NEXT_PUBLIC_API_URL=http://localhost:3333
```

Instale as dependencias:

```bash
npm install
npm run prisma:generate --workspace backend
```

Suba com Docker:

```bash
docker compose up -d --build
```

Padroes do Compose desta distribuicao:

- frontend: `3000:3000`
- backend: `3333:3333`
- PostgreSQL: `5432:5432`

A instalacao de producao existente pode manter portas externas diferentes. Preserve o `docker-compose.yml` e o `.env` ja homologados quando estiver atualizando um servidor existente.

## Producao atual conhecida

Frontend publico:

```text
https://inventario.conquesthub.com.br
```

API publica:

```text
https://api-inventario.conquesthub.com.br
```

No build de producao use:

```env
NEXT_PUBLIC_API_URL=https://api-inventario.conquesthub.com.br
```

Nao deixe `http://localhost:3333` embutido no bundle de producao.

## Atualizacao segura de uma instalacao existente

Antes de atualizar, faca backup:

```bash
cd /home/ciadocredito/inventory-system

docker compose exec -T db \
  pg_dump -U inventory inventory \
  > backup_before_v7_5_$(date +%Y%m%d_%H%M%S).sql
```

Depois de copiar os arquivos, reconstrua a aplicacao:

```bash
docker compose build --no-cache backend frontend

docker compose up -d \
  --no-deps \
  --force-recreate backend frontend
```

Valide:

```bash
docker compose ps
docker compose logs --tail=150 backend
curl -i http://localhost:3333/health
```

### Nunca use no banco real

```bash
docker compose down -v
docker volume rm ...
prisma migrate reset
```

O backend usa `prisma db push` no startup. Nao aceite reset ou perda de dados automaticamente.

## Dependencias atualizadas nesta distribuicao

Backend:

- `@fastify/jwt` `^10.2.2`
- SheetJS XLSX `0.20.3` pelo CDN oficial

Frontend:

- Next.js `15.5.25`

Nao execute `npm audit fix --force` automaticamente, pois isso pode aplicar upgrades major que exigem revisao.

## Importacao

Formatos:

- CSV
- XLS
- XLSX
- XML

Colunas padrao:

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

Pool ou categoria invalidos rejeitam a linha. A importacao nao cria Pools ou categorias automaticamente.

## Cloudflare e upload de Excel

O upload pode disparar o OWASP Managed Rules `949110: Inbound Anomaly Score Exceeded`.

A excecao recomendada deve ser restrita a:

```text
POST /imports/assets/preview
POST /imports/assets
```

No Cloudflare use `Skip/Ignorar` somente para **Managed WAF Rules** nesses endpoints. Nao desative Rate Limiting, regras personalizadas ou protecao de bots sem necessidade.

## Usuario inicial em banco novo

Em um banco totalmente novo, o seed cria:

```text
admin@inventory.local
admin123
```

Troque a senha imediatamente pela tela de usuarios.

## Testes

Depois de instalar as dependencias:

```bash
npm run prisma:generate --workspace backend
npm run build --workspace backend
npm run build --workspace frontend
```

Testes de dominio:

```bash
npm test --workspace backend
```

Teste de integracao isolado:

```bash
docker compose -f compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
```

Nunca aponte a suite de integracao para o banco de producao.

## Documentacao

- `README-V7.5.md` - resumo das alteracoes da v7.5
- `docs/PERMISSOES_V7.5.md` - permissoes granulares
- `docs/CONTEXTO_INVENTORY_V7_5_DESKTOP.md` - contexto para continuidade no ChatGPT Desktop
- `docs/ATUALIZACAO_V7.md` - orientacoes historicas da v7
- `docs/REGRA_ESTOQUE.md` - regras de estoque/componentes
- `docs/VERIFICACAO_V7.5.md` - validacoes realizadas nesta entrega
