# Permissões e endpoints v7

## Política efetiva

ADMIN tem acesso global. MANAGER e VIEWER usam UserPool, com nenhuma liberação por padrão. Pool inativo não aparece para não administradores. Uma alteração de liberação passa a valer nas próximas requisições; a interface aberta deve ser atualizada para limpar informações já carregadas.

Arquivos centrais:

```text
backend/src/plugins/auth.ts
backend/src/utils/visibility.ts
backend/src/utils/access.ts
backend/src/modules/users/routes.ts
```

A autenticação consulta usuário ativo, perfil, tokenVersion e liberações no banco. Redefinição de senha incrementa tokenVersion e invalida sessões antigas. Mudança de perfil exige novo login. Escritas por Pool verificam novamente as permissões na transação.

Listagens retornam só o escopo permitido. Detalhes fora do escopo usam erro genérico 404, sem revelar dados. Falta de privilégio para uma ação retorna 403. Receber um ID pelo navegador não concede acesso ao registro.

Categorias, tipos e campos personalizados continuam definições globais. Os contadores de ativos são filtrados. Não existe rota pública para consultar todos os AuditLogs. O histórico de importações legado, que não possuía proprietário/escopo, fica visível apenas para ADMIN; os demais veem seus próprios novos trabalhos quando ainda possuem acesso a todos os Pools envolvidos.

## Novos endpoints de estoque

Todos exigem JWT. Escritas exigem ADMIN ou MANAGER e acesso ao Pool.

```text
GET    /stock/catalog?poolId=...
POST   /stock/profiles
PUT    /stock/profiles/:id
DELETE /stock/profiles/:id                 arquiva somente sem saldo/vínculos ativos
POST   /stock/profiles/:id/stock
POST   /stock/assign
GET    /stock/assets/:id/components
POST   /stock/components/:id/remove
GET    /stock/movements?poolId=...&page=1
POST   /assets/batch
```

Corpo de associação de componentes a ativos existentes:

```json
{
  "requestId": "6e708d2f-1dcf-4ef8-8b83-94dbb8f4a1bd",
  "poolId": "ID_DO_POOL_AUTORIZADO",
  "assetIds": ["ID_DO_COMPUTADOR"],
  "components": [
    {"profileId": "ID_DO_PERFIL", "quantity": 1, "origin": "REGISTER_INSTALLED"}
  ]
}
```

Gere um requestId novo para uma nova operação; reutilize-o somente ao repetir a mesma operação após falha de comunicação. Não reutilize o UUID ilustrativo em produção.

## Mudanças de contrato

`POST /users` e `PUT /users/:id` aceitam `poolIds: string[]`. `GET /users` retorna `poolAccess` com poolId/nome/status. `GET /auth/me` inclui poolIds; `null` indica ADMIN.

`POST /categories` aceita parentId opcional. Pools e categorias globais agora exigem ADMIN para escrita. `GET /pools` adiciona stock.total, stock.available e stock.installed. `GET /assets/:id` continua retornando dados do ativo, com movimentos de outros Pools não autorizados omitidos.

A planilha de importação de ativos mantém o contrato da v6. Não existe liberação de Pool automática por nome, categoria, e-mail ou setor escrito na planilha.
