# Permissoes v7.5

## Regra central

- `UserPool`: define os Pools que o usuario pode enxergar/usar.
- `UserPermission`: define as operacoes liberadas.
- `ADMIN`: acesso global e todas as permissoes.
- Gestao de usuarios: permanece exclusiva de `ADMIN`.

| Codigo | Efeito |
|---|---|
| GLOBAL_ASSET_LOOKUP | Consulta exata de ate 50 patrimonios em qualquer Pool |
| GLOBAL_DASHBOARD_STATS | Total, valor patrimonial, em uso e disponiveis globais |
| ASSET_CREATE | Cadastrar ativos nos Pools permitidos |
| ASSET_EDIT | Editar dados de ativos permitidos |
| ASSET_MOVE | Trocar Pool de um ativo; na interface e usado junto com ASSET_EDIT |
| ASSET_DELETE | Excluir ativos permitidos |
| IMPORT_ASSETS | Analisar e importar planilhas nos Pools permitidos |
| POOL_CREATE | Criar Pool; o criador nao-ADMIN recebe acesso automaticamente |
| POOL_EDIT | Editar, inativar e reativar Pools atribuidos |
| POOL_DELETE | Excluir Pools atribuidos quando estiverem vazios |
| CATEGORY_CREATE | Criar categoria global |
| CATEGORY_EDIT | Editar categoria global |
| CATEGORY_DELETE | Excluir categoria global sem vinculos |
| FOLDER_CREATE | Criar pastas nos Pools permitidos |
| FOLDER_DELETE | Excluir pastas vazias nos Pools permitidos |
| STOCK_MANAGE | Criar/editar perfis, movimentar saldos e associar/remover componentes |
| NON_PATRIMONIAL_CREATE | Cadastrar itens sem patrimonio nos Setores permitidos |
| NON_PATRIMONIAL_EDIT | Editar dados de itens nao patrimoniados |
| NON_PATRIMONIAL_MOVE | Entrada, baixa, ajuste e transferencia entre Setores |
| NON_PATRIMONIAL_ARCHIVE | Arquivar itens com saldo zerado preservando historico |
| IMPORT_NON_PATRIMONIAL | Importar CSV, XLS, XLSX ou XML de itens nao patrimoniados |

## Defaults migrados

`MANAGER` antigo recebe:
- ASSET_CREATE
- ASSET_EDIT
- ASSET_DELETE
- ASSET_MOVE
- IMPORT_ASSETS
- FOLDER_CREATE
- FOLDER_DELETE
- STOCK_MANAGE

`VIEWER` antigo nao recebe escrita automaticamente.

Os dois acessos globais antigos sao convertidos para `GLOBAL_ASSET_LOOKUP` e `GLOBAL_DASHBOARD_STATS` quando estavam habilitados.
