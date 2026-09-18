# Verificacao da distribuicao completa v7.5

Data: 2026-09-18

## Montagem

Esta distribuicao completa foi criada usando o projeto completo v7 como base e sobrepondo todos os arquivos consolidados da atualizacao v7.5. Assim, o ZIP final contem Dockerfiles, Compose, backend, frontend, Prisma, testes, samples e documentacao, e nao apenas os arquivos de patch.

## Ajustes adicionais aplicados

- versao dos workspaces atualizada para `0.7.5`;
- `@fastify/jwt` atualizado para `^10.2.2`;
- `xlsx` atualizado para o pacote oficial SheetJS `0.20.3`;
- Next.js fixado em `15.5.25`;
- testes de integracao atualizados para criar MANAGER com as permissoes padrao da v7.5;
- contexto para ChatGPT Desktop adicionado em `docs/CONTEXTO_INVENTORY_V7_5_DESKTOP.md`.

## Verificacao executada neste ambiente

Foi executada uma passagem do compilador TypeScript em modo sem resolucao de dependencias para todos os arquivos `.ts` e `.tsx` do backend, Prisma e frontend.

Resultado:

```text
Nenhum erro de parsing/sintaxe TS1xxx encontrado.
```

A instalacao de dependencias (`npm install`) nao foi concluida neste ambiente dentro do limite disponivel. Por isso, o build completo de Fastify/Prisma/Next deve ser executado no ambiente do projeto antes do deploy.

## Validacao obrigatoria antes de producao

```bash
npm install
npm run prisma:generate --workspace backend
npm run build --workspace backend
npm run build --workspace frontend
```

Depois, em homologacao:

```bash
docker compose up -d --build
curl -i http://localhost:3333/health
```

Validar especialmente:

1. migracao/backfill de permissoes;
2. VIEWER com permissoes isoladas;
3. MANAGER existente apos o seed;
4. filtro de Ativos por Pool;
5. `Ver ativos` e `Ver estoque` na tela Pools;
6. consulta global de varios patrimonios;
7. Dashboard global incluindo valor patrimonial;
8. importacao Excel atraves do Cloudflare;
9. ausencia de `localhost:3333` no bundle de producao.
