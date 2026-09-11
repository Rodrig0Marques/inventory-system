# Inventory System v6

Sistema interno de gestão patrimonial para ativos de TI, RH, Administrativo e qualquer outro domínio da empresa.

## Novidades da v6

- Pool e Categoria agora são informados em **cada linha** do arquivo de importação.
- Removidos os seletores únicos de Pool e Categoria da tela de Importações.
- Nova etapa de **pré-validação** antes de gravar qualquer ativo.
- Linhas com Pool ou Categoria inexistentes são rejeitadas e não são cadastradas.
- O sistema não cria Pool ou Categoria automaticamente por causa de erro de digitação.
- Comparação de Pool/Categoria ignora maiúsculas, minúsculas e acentos (`TI`, `ti` e `Ti` são equivalentes).
- Preço inválido e campos obrigatórios ausentes são sinalizados antes da importação.
- Patrimônios duplicados no mesmo Pool dentro do próprio arquivo são rejeitados.
- A prévia informa se o registro será **Criado** ou **Atualizado**.
- O botão **Baixar modelo XLSX** gera um arquivo atualizado com abas de referência de Pools e Categorias cadastrados no sistema.
- Mantidos usuários, permissões e recursos da v5.

## Perfis de acesso

| Perfil | Permissões |
| --- | --- |
| `ADMIN` | Acesso total, incluindo gerenciamento de usuários |
| `MANAGER` | Cria, altera e exclui ativos, pools, categorias, pastas e importações |
| `VIEWER` | Consulta dashboard, ativos, pools, estrutura e histórico de importações |

As permissões são validadas também no backend. Uma ação não autorizada retorna HTTP `403`.

## Principais recursos

- Autenticação JWT com validade de 8 horas.
- Dashboard patrimonial.
- Gerenciamento de usuários.
- Criação e exclusão de Pools.
- Criação e exclusão de Categorias.
- Criação e exclusão de Pastas e Subpastas.
- Proteção contra exclusão de estruturas que ainda possuem ativos.
- Cadastro e exclusão de ativos.
- Organização por Pool, Pasta e Categoria.
- Cadastro simplificado com patrimônio, nome, descrição, fabricante, modelo, preço, localização e responsável.
- Importação em lote por CSV, XLS, XLSX e XML com pré-validação.
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

Acessos padrão:

- Frontend: http://localhost:3000
- API: http://localhost:3333
- Health: http://localhost:3333/health
- PostgreSQL: localhost:5432

Usuário inicial de uma instalação nova:

```text
E-mail: admin@inventory.local
Senha:  admin123
```

Altere a senha inicial e o `JWT_SECRET` antes de colocar o sistema em produção.

## Importação v6

Formatos aceitos:

- `.csv`
- `.xls`
- `.xlsx`
- `.xml`

A primeira aba da planilha deve conter estas colunas:

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

Campos obrigatórios:

- `patrimonio`
- `nome`
- `pool`
- `categoria`

Exemplo:

```text
patrimonio | nome                 | pool           | categoria   | fabricante | modelo
TI-0001    | Notebook corporativo | TI             | Notebook    | Dell       | Latitude 5450
TI-0002    | Monitor 24            | TI             | Monitor     | LG         | 24MP400
ADM-0001   | Cadeira ergonômica    | Administrativo | Mobiliário  | Flexform   | Uni
```

### Fluxo

```text
Selecionar arquivo
      ↓
Analisar arquivo
      ↓
Pré-validação
      ↓
┌────────────────┬────────────────────┐
│ Linhas válidas │ Linhas rejeitadas  │
│ Criar/Atualizar│ Exibir motivo      │
└────────────────┴────────────────────┘
      ↓
Importar somente os válidos
```

Regras importantes:

- Pool precisa existir e estar ativo.
- Categoria precisa existir.
- O sistema aceita diferenças apenas de caixa e acentuação. Ex.: `MOBILIÁRIO`, `mobiliário` e `Mobiliario` apontam para a mesma categoria cadastrada.
- Não há correção aproximada de nomes. `Notbook` **não** será convertido em `Notebook`.
- Pool ou Categoria inexistentes não são criados automaticamente.
- Linha inválida não é gravada.
- Se o mesmo patrimônio já existir no mesmo Pool, a linha válida atualiza o ativo existente.
- Se houver o mesmo patrimônio repetido para o mesmo Pool dentro do arquivo, a repetição é rejeitada.

O botão **Baixar modelo XLSX** consulta o backend e gera o modelo com duas abas auxiliares:

- `POOLS`: Pools ativos disponíveis.
- `CATEGORIAS`: Categorias disponíveis.

O arquivo estático `modelo_importacao_ativos.xlsx` da raiz serve como exemplo, mas o modelo baixado pela tela é o mais indicado porque reflete os cadastros atuais.

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

GET    /assets                TODOS
GET    /assets/summary        TODOS
GET    /assets/:id            TODOS
POST   /assets                ADMIN, MANAGER
PUT    /assets/:id            ADMIN, MANAGER
DELETE /assets/:id            ADMIN, MANAGER
POST   /assets/:id/move       ADMIN, MANAGER

GET    /imports               TODOS
GET    /imports/template      TODOS
POST   /imports/assets/preview ADMIN, MANAGER
POST   /imports/assets        ADMIN, MANAGER
```

Todos os endpoints, exceto `/health` e `/auth/login`, exigem:

```text
Authorization: Bearer <token>
```

## Atualizar da v5 para v6

A v6 não altera o schema do banco, portanto não é necessário apagar o PostgreSQL nem recriar o volume.

```bash
docker compose down
docker compose up -d --build
```

Se o frontend continuar com um bundle antigo, reconstrua apenas ele:

```bash
docker compose build --no-cache frontend
docker compose up -d --force-recreate frontend
```

Não use `docker compose down -v` se quiser manter os dados.

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
