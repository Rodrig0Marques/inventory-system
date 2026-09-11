# Verificação da entrega v7

## Executado no ambiente de geração

- 33 testes unitários do arquivo backend/tests/domain.test.ts: 33 aprovados, nenhum reprovado.
- Checagem TypeScript estrita dos arquivos puros de domínio de estoque, escopo de visibilidade, validação de chave JWT e seus testes: sem erros.
- Transpilação para verificação de sintaxe de 36 arquivos .ts/.tsx: nenhum erro de sintaxe. Isso não substitui a checagem de tipos com dependências nem o build do Next.js.
- Os testes incluem os dois modos de associação, devolução/baixa, estoque insuficiente, quantidades inválidas, escopo vazio, escopo administrativo, Pool não autorizado e recusa de segredos de exemplo.

O log unitário acompanha esta entrega em docs/testes-unitarios.txt.

## Não executado aqui

Não houve instalação completa das dependências: o ambiente falhou na resolução DNS de registry.npmjs.org. Docker e PostgreSQL não estavam disponíveis. Assim, não foi executado:

- prisma generate / db push em banco de teste;
- build integral do backend;
- build e inspeção da interface Next.js no navegador;
- suíte de integração com PostgreSQL/Fastify;
- atualização de uma cópia do banco do usuário.

O código deve passar por esses testes na homologação antes do uso real. Não trate testes unitários ou verificação de sintaxe como prova de integração completa.

## Suíte de integração incluída

backend/tests/integration.ts usa Fastify.inject e PostgreSQL, com guardas para aceitar apenas banco de teste e RUN_INTEGRATION_TESTS=1. O Compose de teste usa projeto inventory-v7-tests, banco inventory_v7_test, armazenamento temporário tmpfs e nenhuma porta publicada. Não reutiliza o volume do inventário.

```bash
docker compose -f compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
```

A suíte cobre: autenticação, restrição RH/TI, conta sem Pool, Viewer sem escrita, ID de outro Pool, contadores, estoque insuficiente, duas instalações disputando a última unidade, idempotência, devolução, baixa, lote com pastas, rollback do lote, importação fora do escopo, revogação de Pool e revogação de sessão por troca de senha.

Esses testes foram escritos, mas não executados neste ambiente. A conta/senha/chave do compose.test.yml são exclusivas de teste e não devem ser copiadas para produção.

## Roteiro manual antes da liberação

1. Confirmar login ADMIN, criar conta RH e conta TI com liberações distintas; validar lista, busca, resumo, estoque, pasta, modelo XLSX e acesso direto por ID.
2. Criar hierarquia Memórias / Memória 8gb / 8gb 2666Ghz e um perfil no Pool TI.
3. Registrar duas unidades disponíveis e uma unidade previamente instalada: disponíveis 2, instaladas 1, total 3.
4. Instalar outra unidade retirando do disponível: disponíveis 1, instaladas 2, total 3. Conferir pais da categoria e contadores por Pool.
5. Repetir a mesma requisição com o mesmo requestId; confirmar que os saldos não mudam novamente.
6. Tentar retirar mais do que o disponível, excluir equipamento com componente, associar perfil de outro Pool e criar lote com patrimônio repetido. Todas devem falhar sem gravação parcial.
7. Devolver um componente e dar baixa em outro, conferindo o histórico. Confirmar quantidade final.
8. Criar lote de três computadores com pastas individuais e dois componentes por equipamento. Verificar pastas, seis unidades e o isolamento para a conta RH.
9. Reiniciar containers e confirmar saldos, permissões e dados antigos.

## Observações de produção

Mantidas as dependências da v6; não houve auditoria completa de vulnerabilidades nesta entrega. Gere lockfiles no ambiente de build validado e revise dependências, HTTPS, permissões do banco, CORS, backup, segredos e restauração antes da implantação. Os limites de lote são 200 ativos/30 perfis; ainda falta teste de carga com o volume real de dados.
