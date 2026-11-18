# Revisão dos fluxos de inventário — 11/11/2026

## Atualização de uma instalação existente

Faça backup do banco antes da atualização. Gere o Prisma Client e aplique o upgrade aditivo antes de iniciar o novo backend:

```sh
cd backend
npx prisma generate
npx prisma db execute --file prisma/updates/20261111_workflows.sql --schema prisma/schema.prisma
npm run build
```

O SQL é repetível e preserva registros e colunas legadas. O startup Docker existente também usa `prisma db push` seguido do seed de migração de permissões. Não use reset do banco nem aceite remoção de dados. O SQL foi pensado para instalações que já possuem o schema v7.6; bancos novos devem receber o schema completo.

Na imagem final do Docker, o seed é executado com `node dist/prisma/seed.js`, usando os mesmos módulos compilados do backend. Depois de atualizar o Dockerfile, recrie o serviço com `docker compose up -d --build backend`; reiniciar o container antigo mantém o comando anterior.

## Contratos e regras

- A identidade do patrimônio continua sendo Setor + código. A busca global aceita `poolId`, `page` e `pageSize`, retorna `total`, `hasMore`, `notFound` considerando a consulta inteira e `ambiguous`. Nenhum código existente foi renumerado.
- `DELETE /assets/:id` agora arquiva, preservando cadastro, movimentações e componentes já removidos. Instalados precisam ser resolvidos antes do arquivamento. `POST /assets/:id/reactivate` restaura o cadastro. Ambos usam a permissão histórica `ASSET_DELETE`; nenhum endpoint de exclusão física é exposto. A listagem aceita `archived=false|true|all`. Ativos arquivados não entram no resumo nem recebem edições/instalações.
- As consultas de ativos e não patrimoniados incluem subcategorias por padrão. `includeDescendants=false` restringe à categoria exata. As contagens diretas continuam em `_count`; `assetTotal` e `nonPatrimonialTotal` representam toda a subárvore.
- `GET /stock/catalog?active=false|true|all` permite consultar arquivados; `POST /stock/profiles/:id/reactivate` reativa perfis. O nome permanece reservado para preservar sua identidade histórica.
- Transferência com componentes exige `transferComponents=true`, `requestId` UUID e permissões `ASSET_MOVE` + `STOCK_MANAGE`. Os perfis de destino são reutilizados somente quando categoria e especificações coincidem; conflitos rejeitam toda a operação. Os saldos disponíveis não mudam, as unidades instaladas migram de Setor e o total global permanece igual. Retentativas com o mesmo UUID não repetem movimentos. A opção está disponível na edição do ativo.
- A importação exige análise prévia. Use `POST /imports/assets/preview?mode=CREATE|UPDATE` ou `/imports/non-patrimonial/preview?mode=CREATE|UPDATE|SET_BALANCE`. A confirmação envia o mesmo arquivo e o UUID `previewId` no header `x-request-id`. A prévia expira em 24 horas; confirmações já concluídas podem ser consultadas novamente pelo mesmo identificador enquanto houver autorização.
- `CREATE` só cadastra; `UPDATE` só altera cadastro e preserva saldo; `SET_BALANCE` só altera o saldo final de itens existentes. A prévia mostra antes/depois. Itens arquivados nunca são reativados por importação. Alterações ocorridas após a prévia rejeitam a linha. Campos opcionais vazios preservam os valores existentes nas atualizações. O processamento continua parcial por linha, com relatório de erros; cada linha e a conclusão possuem proteção contra reenvio. Cargas CREATE idênticas do mesmo usuário são protegidas contra duplicação, inclusive se duas prévias forem confirmadas simultaneamente. Uma nova carga intencional deve usar outro arquivo e ser revisada.
- Campos personalizados existentes são preservados e aparecem no cadastro/edição conforme a categoria. O backend valida obrigatoriedade, tipos, datas e opções. Tipos/campos avançados continuam compatíveis com os endpoints existentes; não houve remoção de tabelas sem análise do uso real.
- Auditoria administrativa em `GET /audit` com filtros `entity`, `entityId`, `userId`, `action`, `page`, `pageSize`. Apenas ADMIN tem acesso. Os detalhes do ativo mostram as movimentações permitidas à conta. `GET /non-patrimonial/:id/movements` retorna `{items,total,page,pageSize}`, substituindo o corte silencioso em 200 movimentos.
- Após `permissionsInitialized=true`, somente `UserPermission` concede permissões granulares. As flags antigas são preservadas para compatibilidade, mas não concedem acesso por conta própria. O backfill e o seed preservam as concessões das contas antigas antes de marcar a migração.

## Separação dos módulos

Ativos representam bens individualizados; estoque/componentes representam unidades instaláveis; não patrimoniados representam materiais por quantidade. Categorias e subcategorias continuam globais, com nomes únicos para manter a importação por nome determinística. As regras de saldo, escopo por Setor e histórico não foram unificadas artificialmente.

## Validação

- Build do backend e build de produção do frontend.
- 33 testes de domínio e 39 testes de integração em PostgreSQL descartável via `compose.test.yml`, sem volumes de produção.
- Migração SQL executada duas vezes, preservando concessões antigas sem restaurar permissões revogadas de contas já migradas.
- Verificação no navegador de 12 rotas, em desktop/celular e temas claro/escuro, sem erros de execução ou transbordamento horizontal da página. Conferência das interações de reativação, campos personalizados, transferência com componentes, prévia de saldo e auditoria com respostas simuladas; as regras reais do backend são cobertas pelos testes de integração.

A atualização do banco de uma instalação existente ainda precisa ser aplicada durante a implantação. Nenhuma migração foi executada no banco de produção nesta revisão.

## Complemento de 12/11/2026 — movimentações e relatórios

- `POST /non-patrimonial`, `POST /non-patrimonial/:id/stock` e `POST /non-patrimonial/:id/transfer` agora exigem `requestId` UUID no corpo. Reenvie o mesmo identificador e conteúdo ao repetir uma requisição sem resposta. Uma operação intencionalmente nova usa outro UUID. As telas foram atualizadas para manter o identificador nas tentativas. Respostas armazenadas só são liberadas após revalidar o acesso atual aos Setores envolvidos.
- A transferência de materiais aceita `toLocation` e `toResponsible`, opcionais, usados apenas para criar o cadastro no destino. Sem esses valores, os campos ficam nulos; os dados da origem não são copiados. Quando já existe um cadastro ativo da mesma linhagem no destino, seus dados são preservados e apenas a quantidade aumenta. Nenhum dado antigo foi corrigido automaticamente.
- `POST /stock/profiles/:id/transfer` movimenta componentes disponíveis entre Setores e exige `STOCK_MANAGE`, acesso aos dois Setores ativos, `requestId`, `toPoolId`, quantidade inteira positiva e motivo. O destino é resolvido pelas mesmas regras de compatibilidade da transferência de equipamentos. Saída, entrada, perfil novo se necessário e auditoria são gravados na mesma transação. Não altera componentes instalados nem o total global. A opção está no catálogo, em “Transferir disponíveis”.
- `GET /imports/:id` consulta o resultado e as rejeições. `GET /imports/:id/errors.csv` baixa somente as linhas rejeitadas, com as colunas originais disponíveis, `linha_original` e `motivo_erro`. Corrija o CSV e analise novamente; as colunas auxiliares são ignoradas na importação. Células que poderiam executar fórmulas em planilhas são exportadas como texto.
- Os relatórios respeitam autoria e os acessos atuais aos Setores; ADMIN pode consultar todas as importações. O resultado abre após a confirmação e também pode ser acessado no histórico. As novas importações preservam os dados originais das linhas rejeitadas na validação e na gravação; registros antigos exibem apenas os detalhes que já possuíam.
- Este complemento não altera o schema do banco. Backend e frontend devem ser atualizados juntos: `docker compose up -d --build backend frontend`.

Validação do complemento: 33 testes de domínio e 48 testes de integração aprovados em PostgreSQL descartável, incluindo reenvios simultâneos, conservação dos totais, conflito de especificações, saldo insuficiente, acesso revogado e exportação segura dos erros.
