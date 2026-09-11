# Atualização v6 para v7

## Antes de atualizar

Esta versão muda o schema: adiciona UserPool, ItemProfile, AssetComponent, StockMovement e StockOperation, enums de estoque, Category.parentId, User.tokenVersion e campos de escopo em ImportJob. Não remove colunas da v6. O fato de as mudanças serem aditivas não dispensa backup e teste.

O build completo e os testes com PostgreSQL não foram executados pelo ambiente de geração. Execute primeiro `compose.test.yml` e homologue com uma cópia controlada dos dados, sem apontar a suíte para a produção.

Faça a mudança em janela de manutenção. O frontend e backend devem ser atualizados juntos. Preserve o diretório do projeto e o nome do projeto Compose para continuar usando o volume correto.

## 1. Backup do PostgreSQL

No servidor Linux da instalação existente:

```bash
cd /home/ciadocredito/inventory-system
mkdir -p backups
docker compose exec -T db pg_dump -U inventory -d inventory -Fc > backups/inventory-pre-v7-$(date +%F-%H%M%S).dump
```

Confirme código de saída zero, tamanho do arquivo e teste uma restauração em ambiente separado. Não publique backups, `.env` ou chaves no GitHub.

## 2. Aplicar os arquivos

O ZIP `inventory-system-v7-atualizacao.zip` contém os arquivos novos/alterados em relação ao ZIP da v6, com caminhos relativos à raiz do projeto. Ele **não inclui** `.env`, `.env.example`, `docker-compose.yml`, node_modules ou backups.

Extraia primeiro em uma pasta temporária e compare com o código atual. Depois copie os arquivos aprovados para a raiz da instalação. O arquivo MANIFESTO-ATUALIZACAO.json lista os arquivos e seus hashes. Se houver customizações locais nesses arquivos, concilie-as antes de substituir.

O ZIP completo possui a pasta `inventory-system/` com o projeto inteiro, mas seu Compose usa portas padrão. Não substitua inadvertidamente as configurações atuais pelo Compose padrão.

Mantenha nesta instalação:

```text
frontend: 4500:3000
backend: 3333:3333
db: 5433:5432
```

Mantenha o DATABASE_URL apontando para `db:5432`, com a senha real já cadastrada no PostgreSQL. **Não altere POSTGRES_PASSWORD nem DATABASE_URL para esta atualização.**

## 3. Chave JWT: atenção ao valor de exemplo

A v7 bloqueia a inicialização com chave vazia, curta ou com placeholders conhecidos. O valor `change-me-in-production` mostrado anteriormente não é aceito.

Gere uma chave no próprio servidor:

```bash
openssl rand -hex 32
```

Copie o resultado completo para `JWT_SECRET=` no `.env` existente. Não use uma chave publicada em chat ou repositório. Preserve todas as demais configurações, inclusive `NEXT_PUBLIC_API_URL=http://10.0.0.246:3333`, quando esse ainda for o endereço correto. A troca invalida as sessões; será necessário entrar novamente.

## 4. Construir e subir apenas a aplicação

Com o serviço `db` existente já em execução:

```bash
docker compose build backend frontend
docker compose up -d --no-deps backend frontend
docker compose ps
docker compose logs --tail=100 backend
```

A inicialização do backend, herdada da v6, executa `npx prisma db push`, depois seed e servidor. Confira os logs; não ignore pedidos de reset ou erros do Prisma. Esta entrega não fornece um histórico de migrations versionadas nem autoriza uso de `--accept-data-loss`.

Não é necessário `--no-cache` normalmente. **Não execute `docker compose down -v`, `docker volume rm` ou `prisma migrate reset` no banco real.**

O acesso desta instalação permanece em `http://10.0.0.246:4500`. Recarregue a página após a atualização.

## 5. Liberar Pools para usuários

Entre com uma conta ADMIN existente. Em **Usuários > Editar > Pools permitidos**, conceda os setores desejados aos MANAGER/VIEWER. Eles não recebem automaticamente todos os Pools; a nova tabela de liberações começa vazia.

Exemplo:
- Conta RH: MANAGER ou VIEWER, somente Pool RH.
- Conta TI: MANAGER ou VIEWER, somente Pool TI.
- Conta com acesso a ambos: selecione os dois Pools.
- ADMIN: acesso global, independentemente da seleção.

Confira listagem, busca, dashboard, estoque e importação com as contas de cada setor. Contas sem Pool devem continuar conseguindo autenticar, mas não podem consultar nem modificar ativos de outros setores.

## 6. Implantar o estoque sem duplicar o inventário

Cadastre categorias/subcategorias e perfis antes dos saldos. Conte fisicamente o que está disponível. Associe aos equipamentos apenas componentes reais ainda não contabilizados ou retirados do saldo disponível. Os registros de ativos antigos não são convertidos automaticamente em unidades de estoque.

Guarde backup, código e imagens anteriores. Uma reversão deve ser planejada e testada; não restaure um dump sobre o banco em uso sem avaliar as gravações feitas depois do backup.
