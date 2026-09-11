# Inventory System v7

Estoque de componentes, perfis reutilizáveis, categorias hierárquicas, cadastro em lote e visibilidade de ativos por Pool.

**Base desta entrega:** ZIP da v6 fornecido na conversa. Esta entrega não foi buscada nem enviada ao repositório GitHub. Preserve e concilie quaisquer alterações locais feitas depois da v6.

**Estado de validação:** 33 testes unitários passaram, os arquivos puros de domínio/política tiveram checagem de tipos e 36 arquivos TS/TSX passaram pela verificação de sintaxe. O build completo, a geração do Prisma, os testes com PostgreSQL e a interface em navegador não foram executados no ambiente de geração. **Homologue antes de atualizar o banco de produção.** Veja [Verificação](docs/VERIFICACAO_V7.md).

## Atualização de uma instalação existente

Siga [ATUALIZACAO_V7.md](docs/ATUALIZACAO_V7.md) antes de iniciar os containers. Esta versão **adiciona tabelas e campos ao PostgreSQL**. O processo de inicialização herdado da v6 executa `prisma db push` e o seed.

- Preserve `.env`, `docker-compose.yml`, diretório do projeto e volume do banco existentes.
- `JWT_SECRET` de exemplo, vazio ou com menos de 32 bytes é rejeitado. Gere uma chave privada com `openssl rand -hex 32` e configure apenas essa variável quando necessário; não troque a senha do PostgreSQL por causa desta atualização.
- Usuários ADMIN acessam todos os Pools. MANAGER e VIEWER existentes começam **sem liberações de Pool**. O administrador deve conceder o acesso na tela Usuários.
- As configurações de rede, portas e `NEXT_PUBLIC_API_URL` não foram substituídas por um proxy nesta entrega.

## O que foi acrescentado

### Estoque e componentes

Novo menu **Estoque e componentes**, com quatro abas:

1. **Catálogo:** categorias clicáveis, subcategorias, perfis técnicos e saldos.
2. **Associar a ativos:** aplica componentes a equipamentos existentes, com quantidade por equipamento e origem.
3. **Cadastro em lote:** cria equipamentos, pastas/subpastas e componentes em uma única operação.
4. **Movimentações:** entradas, instalações, devoluções e baixas registradas.

O perfil descreve um item, como uma memória de determinada capacidade e especificação. Ele **não é uma unidade física**. Uma unidade está disponível ou instalada. Consulte [REGRA_ESTOQUE.md](docs/REGRA_ESTOQUE.md) para exemplos e limites.

Ao associar um perfil a um equipamento:

| Origem escolhida | Disponíveis | Instalados | Total |
| --- | --- | --- | --- |
| Retirar do estoque disponível | Diminui | Aumenta | Permanece igual |
| Já instalado / sem retirar do estoque | Permanece igual | Aumenta | Aumenta |

A segunda opção representa unidades reais que já vieram no equipamento e **ainda não foram contabilizadas**. Não deve duplicar uma unidade já existente no inventário.

O nome do ativo na listagem agora abre uma página com seus componentes instalados. Nela é possível devolver uma quantidade ao estoque ou dar baixa no componente, informando o motivo.

### Visibilidade por setor / Pool

Na v6, os perfis controlavam ações, mas não isolavam os registros por setor. Na v7:

| Perfil | Visibilidade | Escrita |
| --- | --- | --- |
| ADMIN | Todos os Pools | Tudo, incluindo usuários e estruturas globais |
| MANAGER | Somente Pools liberados | Ativos, pastas, estoque e importações desses Pools |
| VIEWER | Somente Pools liberados | Nenhuma |

Acesse **Usuários > Editar > Pools permitidos**. Marque apenas RH para um usuário do RH; marque apenas TI para um usuário do TI. Uma conta pode ter mais de um Pool. Sem seleção, não tem acesso aos ativos de nenhum Pool. Não utilize ADMIN para uma conta que deve ficar restrita.

A API aplica o escopo em listagens, detalhes por ID, resumos, pastas, estoque, operações, importações e históricos. Não depende apenas de botões ocultos. As liberações são consultadas no banco a cada requisição autenticada.

**Categorias são uma taxonomia global:** seus nomes e definições continuam compartilhados; os ativos, perfis e contadores são filtrados pelos Pools autorizados. Somente ADMIN cria/exclui categorias e cria/altera/exclui Pools nesta versão. Isso evita que um gestor restrito altere uma estrutura compartilhada com outros setores.

### Cadastro em lote

Selecione um Pool autorizado, a categoria do equipamento e, opcionalmente, uma pasta-base. Cole uma linha por equipamento:

```text
patrimonio;nome;pasta
CAD-001;Computador 01;Estacoes/PC-01
CAD-002;Computador 02;Estacoes/PC-02
CAD-003;Computador 03;Estacoes/PC-03
```

Os rótulos do exemplo são ilustrativos. A coluna `pasta` é opcional. Pastas existentes são reutilizadas; caminhos novos são criados no Pool selecionado. Limite de 200 ativos por lote e 12 níveis por caminho. Os componentes escolhidos são aplicados com a quantidade indicada **em cada equipamento**.

O lote é integral: patrimônio duplicado, falta de acesso ou estoque insuficiente impedem a gravação de todo o lote. A importação Excel da v6 continua separada, com sua pré-validação e gravação apenas das linhas válidas.

## Importação Excel preservada

O modelo de ativos permanece:

```text
patrimonio | nome | pool | categoria | descricao | fabricante | modelo | preco | localizacao | responsavel
```

O modelo dinâmico baixado pela tela lista somente Pools autorizados para o usuário. Os nomes de categorias continuam globais. Linhas para Pools sem permissão são rejeitadas. Esta planilha **não cria saldos de componentes**; use Estoque e componentes para isso.

## Instalação nova

A stack permanece Node 22, Fastify, Prisma 6, PostgreSQL 15, Next.js e Docker Compose.

```bash
cp .env.example .env
openssl rand -hex 32
```

Insira a chave gerada em `JWT_SECRET` e configure `NEXT_PUBLIC_API_URL` com o endereço/porta do backend acessível ao navegador, antes do build. Ajuste portas externas no Compose quando necessário.

```bash
docker compose up -d --build
```

O Compose completo mantém os padrões da v6: frontend 3000, backend 3333 e PostgreSQL 5432 no host. Em servidor com essas portas ocupadas, altere o lado esquerdo dos mapeamentos. A instalação existente informada na conversa usa 4500:3000, 3333:3333 e 5433:5432, respectivamente.

Em um banco realmente novo, o seed cria `admin@inventory.local` / `admin123`. Troque imediatamente a senha na tela de usuários. Um banco existente mantém suas contas; não há redefinição automática de senha.

## Testes e documentação

```bash
cd backend
npm install
npm run prisma:generate
npm test
npm run build
```

Suíte com banco isolado, a partir da raiz:

```bash
docker compose -f compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
```

O arquivo de teste usa projeto separado, banco temporário e nenhuma porta publicada. Não execute a suíte de integração apontando para o banco do inventário real.

Documentos:
- [Atualização e backup](docs/ATUALIZACAO_V7.md)
- [Regras de estoque e escolhas de implementação](docs/REGRA_ESTOQUE.md)
- [Permissões e endpoints](docs/PERMISSOES_V7.md)
- [Verificações executadas e roteiro de homologação](docs/VERIFICACAO_V7.md)

## Limites importantes

Esta entrega não transforma os registros antigos em estoque automaticamente, não implementa transferência de componentes entre Pools, não faz descoberta de hardware e não implementa custeio/depreciação dos componentes. Preserve um ambiente de homologação e revise o deploy para uso corporativo. HTTPS, chave JWT privada, senha de administrador alterada e backups continuam necessários; o controle por Pool não substitui esses cuidados.
