# Regras de estoque e escolhas da v7

## Base funcional

Implementação baseada em `sistema estoque(1).txt`, fornecido pelo usuário: perfis reutilizáveis, baixa opcional ao associar componentes, contadores hierárquicos, cadastro de equipamentos/subpastas em lote e separação por setor (Pool).

## Perfis e unidades são diferentes

ItemProfile é o modelo técnico reutilizável. Asset é o equipamento patrimonial. AssetComponent registra a quantidade daquele perfil instalada em um equipamento. O cadastro de um perfil com saldo zero não aumenta o total de unidades.

```text
Total de unidades do perfil = disponíveis + instaladas
Total da categoria = soma dos perfis da categoria e de suas descendentes
```

A soma da categoria não soma de novo os contadores de pais e filhos. Contadores gerais são calculados a partir dos perfis, uma vez por unidade. Equipamentos patrimoniais e unidades de componentes são mostrados separadamente.

## Exemplo do TXT

Antes: Memória 8gb com total 200/disponíveis 10; variante 8gb 2666Ghz com total 100/disponíveis 2. Registrar uma unidade real dessa variante que já estava instalada em um computador leva a:

```text
Memória 8gb: total 201 / disponíveis 10
8gb 2666Ghz:   total 101 / disponíveis 2
```

Se a mesma instalação usar uma unidade retirada do estoque já registrado, o total da variante permanece 100 e o disponível passa a 1.

Os nomes e unidades escritos nas especificações são rótulos livres. O sistema não interpreta, converte ou corrige automaticamente `2666Ghz`, `3200Ghz` ou qualquer outro texto do catálogo.

## Modos de associação

- FROM_STOCK: exige saldo, diminui disponíveis e aumenta instalados na mesma quantidade. Não altera o total.
- REGISTER_INSTALLED: registra unidades instaladas reais que ainda não foram contadas. Aumenta instalados e total; não altera disponíveis.

Não use REGISTER_INSTALLED para a mesma unidade física já cadastrada como disponível ou instalada. A API não consegue descobrir fisicamente essa duplicidade sem identificação unitária/serial.

## Devolução, baixa e arquivo

RETURN_TO_STOCK reduz instalados e aumenta disponíveis; o total não muda. RETIRE_INSTALLED reduz instalados e total sem aumentar disponíveis. Ambas exigem quantidade válida e motivo. As movimentações de estoque são mantidas como histórico.

Perfil sem unidades pode ser arquivado. Arquivo não apaga seu histórico nem libera seu nome para reutilização no mesmo Pool. Esta entrega não possui tela de restauração de perfis arquivados.

Excluir, inativar, baixar ou transferir para outro Pool um equipamento com componentes instalados é bloqueado. Primeiro resolva seus componentes. Transferência direta de componentes entre Pools não foi implementada.

## Categorias hierárquicas

Em **Estrutura**, ADMIN pode selecionar uma categoria-pai ao criar uma categoria. O catálogo permite navegar clicando nos níveis e mostra os contadores agregados de suas descendentes.

Foi mantida a unicidade global do nome de Category existente na v6. Portanto, use folhas como `8gb 2666Ghz` e `16gb 2666Ghz`, em vez de cadastrar duas categorias com o mesmo nome `2666Ghz`. Isso também mantém a identificação por nome na importação v6 sem ambiguidades.

Nomes/definições de categorias são compartilhados. Perfis, quantidades e equipamentos são restritos aos Pools autorizados.

## Lotes

Até 200 equipamentos em um Pool por operação. Até 30 perfis de componente distintos no lote, com 1 a 10.000 unidades por equipamento. O mesmo perfil não pode aparecer duas vezes na lista; ajuste a quantidade na mesma linha.

Todos os equipamentos e perfis de um lote devem pertencer ao mesmo Pool ativo. A quantidade necessária é `equipamentos x quantidade por equipamento`. O lote de cadastro de equipamentos/pastas/componentes é uma transação integral: qualquer falha reverte tudo.

O campo de caminho usa `/` entre pastas, sem níveis vazios, `.` ou `..`, até 12 níveis. Nomes de pastas existentes são comparados exatamente; não há tentativa aproximada de correspondência.

Cada escrita de estoque/lote recebe requestId UUID. A repetição do mesmo identificador pelo mesmo usuário com o mesmo conteúdo retorna a operação registrada; conteúdo diferente com o mesmo identificador é rejeitado. Isso protege reenvios de rede, não detecta duas operações humanas diferentes que cadastram a mesma unidade sem serial.

## Escolhas adicionadas à descrição do usuário

O TXT não definia permissões administrativas, comportamento de devolução/baixa, transferência entre setores ou política de falha no lote. Nesta entrega foram adotados: permissão explícita por Pool; definições globais editáveis somente por ADMIN; lote integral; devolução e baixa com motivo; bloqueio de exclusão/transferência de equipamento com componentes. Estes são critérios de implementação, não detalhes adicionais extraídos do TXT.

Não há conversão automática de dados antigos, BOM aninhada (componentes dentro de componentes), serialização unitária de estoque, custeio/depreciação nem integração com coleta automática de hardware. Componentes ainda não têm importação por XLSX; a associação em lote é feita pela nova tela.
