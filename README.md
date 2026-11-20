<p align="center">
  <img src="docs/logo.png" alt="Logo da Moneta: perfil de uma figura clássica com coroa de louros, dentro de um círculo, como em uma moeda" width="160">
</p>

<h1 align="center">Moneta</h1>

Moneta é um painel de finanças pessoais que roda no seu próprio computador. Ele se conecta aos seus bancos, cartões e corretoras por meio da [Pluggy](https://pluggy.ai), uma plataforma de Open Finance, e guarda tudo em um banco SQLite local. Assim você acompanha receitas, despesas, faturas e patrimônio sem enviar seus dados a um serviço de terceiros além da própria Pluggy.

- **Local e de usuário único:** o servidor escuta apenas em `127.0.0.1` e não tem contas de usuário.
- **Sem dependências externas:** usa só Node.js 22 (servidor HTTP e `node:sqlite` nativos) e HTML, CSS e JavaScript puros no navegador.
- **Interface em português**, com valores em várias moedas mantidos separados.

## Requisitos

- Docker com Docker Compose **ou** Node.js 22.16 ou superior.
- Uma aplicação na Pluggy, com **Client ID** e **Client Secret**. Crie-a no [painel da Pluggy](https://dashboard.pluggy.ai).
- Acesso à internet para a API e o widget de conexão da Pluggy.

## Instalação

### Com Docker Compose (recomendado)

Na raiz do projeto:

```sh
mkdir -p -m 700 data
docker compose up -d --build
```

Abra http://127.0.0.1:4173. Para parar, use `docker compose down`.

A pasta `./data` é montada no container e guarda o banco e as credenciais, por isso os dados sobrevivem a recriações do container. O serviço roda com UID/GID 1000. Se o seu usuário no Linux tiver outros IDs, crie um arquivo `.env` com os valores de `id -u` e `id -g`:

```sh
MONETA_UID=1001
MONETA_GID=1001
```

### Com Node.js

```sh
node --env-file-if-exists=.env server.mjs
```

Abra http://127.0.0.1:4173. Não é preciso instalar pacotes: o projeto não tem dependências npm.

Encerre uma das formas de execução antes de iniciar a outra, pois ambas usam a mesma porta.

### Variáveis de ambiente

Todas são opcionais.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `4173` | Porta do servidor. |
| `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` | vazio | Credenciais da Pluggy. Valem até que outro par seja salvo pela interface. |
| `MONETA_UID` e `MONETA_GID` | `1000` | Usuário e grupo do container (somente Docker). |

## Primeiros passos

1. Em **Configuração**, informe o Client ID e o Client Secret e clique em **Validar e salvar**. As credenciais passam a valer assim que a Pluggy as aceita.
2. Em **Conexões**, clique em **Conectar instituição** e siga o widget da Pluggy para autorizar o acesso ao banco, cartão ou corretora.
3. A Moneta sincroniza a nova conexão logo em seguida. Depois disso, use **Sincronizar** quando quiser atualizar. Com o servidor ligado, uma sincronização automática ocorre a cada 6 horas.

A sincronização lê todo o histórico disponível na Pluggy e só grava o resultado depois de ler todas as conexões. Se algo falhar no meio do caminho, a cópia anterior é mantida.

## Telas

### Visão geral

- **Resumo mensal:** receitas, despesas, resultado e despesas por categoria do mês escolhido. Débitos e créditos em conta contam na data do lançamento. Compras no cartão contam pelo total da fatura no mês do vencimento, inclusive parcelas. Quando a instituição não informa a fatura, a Moneta a reconstrói a partir dos pagamentos identificados e avisa que a cobertura pode estar incompleta. Em **Despesas por categoria**, as faturas aparecem agrupadas em uma linha só, **Faturas de cartão**. Escolha **Somente faturas** para ver a composição delas por categoria.
- **Patrimônio:** posição da última sincronização e sua evolução diária. O **bruto** soma saldos positivos e investimentos brutos. O **líquido** usa investimentos líquidos e desconta dívidas de cartão e saldos negativos. O valor aplicado automaticamente pelo banco é descontado do saldo da conta para não ser contado duas vezes. Valores que a instituição não informou aparecem como indisponíveis.

### Transações

Lista os lançamentos de todas as contas. Você pode:

- escolher o **Período**: o mês selecionado no topo da página ou **Todos os meses**, para ver o histórico inteiro na moeda selecionada;
- buscar pela descrição e filtrar por conta, cartão ou categoria;
- clicar em uma transação para mudar a categoria, escrever uma nota ou criar uma regra a partir dela. Escolha **Automática** para devolver a transação às regras.

Valores positivos aparecem em negrito.

### Carteira

Registra dinheiro em espécie, que não passa pela Pluggy. **Adicionar saldo** e **Retirar saldo** só ajustam o saldo da carteira. **Receita em dinheiro** e **Despesa em dinheiro** também entram no resultado do mês.

Ao lado do saldo em dinheiro, **Saldo nos bancos** soma as contas bancárias na moeda selecionada, como as instituições informaram na última sincronização. As três maiores aparecem logo abaixo do total. Passe o mouse sobre o cartão, ou selecione-o pelo teclado, para ver todas as contas.

### Cartões

Mostra cada cartão de crédito com as compras do ciclo (inclusive parcelas), a situação da fatura (fechada, em aberto ou estimada), o limite total e o limite utilizado. Faturas fechadas continuam disponíveis mesmo depois que saem da janela de histórico da Pluggy.

#### Vales

Vale-transporte, vale-alimentação e outros benefícios não chegam pela Pluggy. Em **Cartões → Vales**, clique em **Adicionar vale** e informe o nome, o valor de cada crédito, a categoria do gasto e a recorrência:

- **Mensal:** todo mês no dia do primeiro crédito. Nos meses sem esse dia (31, por exemplo), cai no último dia do mês;
- **Semanal:** toda semana no mesmo dia da semana do primeiro crédito;
- **Diária:** todos os dias, ou só de segunda a sexta com **Só dias úteis**, como num vale-transporte;
- **Uso único:** um crédito só, como um bônus.

Cada crédito, até a data de hoje, entra no mês como receita na categoria **Benefícios** e, na mesma data, como despesa na categoria do vale. O total de despesas passa a incluir o que foi pago com vale, com um item próprio, **Vales**, e o resultado do mês não muda. Os vales também aparecem no seletor de cartões, com os créditos do mês.

Para parar um vale recorrente sem perder o histórico, edite-o e informe o **Último crédito**. Editar o valor ou a recorrência recalcula todos os créditos do vale. Para mudar só daqui em diante, encerre o vale atual e crie outro. **Excluir** remove o vale e todos os créditos já lançados por ele.

### Categorias

Crie, renomeie, recolora ou remova categorias. Uma categoria marcada como **interna** fica fora do fluxo mensal. Use esse tipo para movimentos que não são receita nem despesa, como pagamentos de fatura e aplicações e resgates de investimentos.

Filtre a lista pela **Origem**: categorias criadas por você (inclusive as criadas ao importar regras) ou que já vêm com a Moneta.

### Regras

Regras classificam lançamentos automaticamente. Cada regra combina condições sobre a descrição, o valor, a data, o tipo, a situação ou o CPF/CNPJ do destinatário. As condições podem exigir que todas coincidam ou que qualquer uma coincida. Os operadores disponíveis são: contém, não contém, começa com, termina com, igual, diferente, expressão regular e comparações numéricas (maior, menor, maior ou igual, menor ou igual).

Filtre a lista pela **Origem**. Regras criadas na Moneta e regras importadas contam como suas; as do catálogo padrão aparecem como **Moneta**.

**Aplicar regras ao histórico** reavalia todos os lançamentos com as regras ativas, preservando as escolhas manuais. Antes de aplicar, a Moneta mostra uma prévia com cada lançamento que muda de categoria, a categoria atual e a nova. Nada muda até você confirmar. Se os dados mudarem entre a prévia e a confirmação (por uma sincronização, por exemplo), a aplicação é recusada e você revisa a prévia de novo.

Nas tabelas de regras e de categorias, clique no título de uma coluna para ordenar. O primeiro clique ordena de forma crescente, o segundo de forma decrescente e o terceiro volta à ordem padrão. A seta ao lado do título mostra a ordenação ativa.

### Configuração

Define a moeda padrão, o tema (escuro, claro ou igual ao sistema, guardado neste navegador), as credenciais da Pluggy e permite reiniciar o servidor (funciona tanto no Docker quanto na execução direta).

### Barra superior

Nas páginas que dependem do mês (Visão geral, Transações, Carteira e Cartões), a barra superior tem os mesmos controles e no mesmo lugar: ano e mês anterior, o seletor de mês, mês e ano seguinte e **Mês atual**, que volta ao mês corrente. O botão com o ícone de olho oculta os valores da tela.

## Como uma transação é classificada

A Moneta usa a primeira fonte disponível, nesta ordem:

1. a categoria escolhida manualmente na transação;
2. as regras criadas na Moneta;
3. as regras do catálogo, em ordem crescente de prioridade (com a mesma prioridade, as regras importadas vêm antes das padrão);
4. a categoria informada pela Pluggy.

Pagamentos de fatura e aplicações e resgates de investimentos são reconhecidos pela descrição e vão para as categorias internas **Pagamento de fatura** e **Movimentação de investimentos**, para não inflarem receitas e despesas. Rendimentos e impostos sobre investimentos continuam contando como receita e despesa.

## Catálogo de regras

O arquivo [`default-rules.json`](default-rules.json) traz regras prontas para comércios e serviços comuns no Brasil, como delivery, mercados, transporte, assinaturas, farmácias e contas da casa, além de pagamentos de fatura, aplicações, salário e rendimentos. Elas aparecem com a origem **Moneta** na tela de regras, podem ser editadas ou desativadas e vêm todas ativas.

Para compartilhar regras com alguém ou levá-las para outra instalação, clique em **Exportar regras**. A Moneta baixa um arquivo JSON (`moneta-categorization-rules`, versão 1) com as regras da origem escolhida no filtro: todas, só as suas ou só as do catálogo, já com as suas edições. As regras criadas na Moneta saem com prioridade menor que a do catálogo, para continuarem vencendo depois de importadas.

Para importar um arquivo nesse formato, vá em **Regras**, selecione o arquivo e clique em **Importar regras**:

- regras com o mesmo nome são atualizadas, por isso importar de novo traz as alterações do arquivo;
- categorias que ainda não existem são criadas;
- a tela sinaliza regras sem uma categoria de destino ou que usam campos que a Moneta ainda não lê;
- com **Aplicar também aos lançamentos existentes** marcado, todo o histórico é reavaliado. Desmarcado, a classificação atual é preservada e as regras importadas valem apenas para lançamentos novos.

## Dados e privacidade

Tudo fica na pasta `data/`, que está no `.gitignore`:

- `data/moneta.sqlite`: conexões, saldos, investimentos, lançamentos, faturas, vales, categorias, regras, notas e histórico de patrimônio;
- `data/pluggy.json`: credenciais salvas pela interface, acessível apenas pelo dono do arquivo. **O segredo fica em texto simples**, então proteja backups e cópias dessa pasta.

O servidor recusa requisições cujo cabeçalho `Host` não seja `localhost` ou `127.0.0.1`, e recusa escritas vindas de outra origem. Os únicos dados que saem da máquina são as chamadas à API da Pluggy.

Outras aplicações locais podem ler a lista de conexões em JSON por `GET /api/connections`.

## Desenvolvimento

Rode os testes com o executor nativo do Node.js:

```sh
node --test
```

Estrutura do projeto:

| Caminho | Conteúdo |
| --- | --- |
| `server.mjs` | Processo supervisor que inicia e reinicia o backend. |
| `backend.mjs` | Servidor HTTP, rotas da API e integração com a Pluggy. |
| `finance.mjs` | Banco SQLite, sincronização e classificação de lançamentos. |
| `category-rules.mjs` | Catálogo de regras, importação e avaliação de condições. |
| `default-rules.json` | Regras padrão do catálogo. |
| `request-body.mjs` | Leitura e validação do corpo JSON das requisições. |
| `public/` | Interface: HTML, CSS e módulos JavaScript (relatório, ciclos de cartão, patrimônio), ícones e fontes. |
| `test/` | Testes automatizados. |

### Fontes

O nome Moneta e os títulos das páginas usam a [Goudy Bookletter 1911](https://github.com/theleagueof/goudy-bookletter-1911), de Barry Schwartz, distribuída em `public/fonts/` sob a SIL Open Font License 1.1 (veja [`public/fonts/OFL.txt`](public/fonts/OFL.txt)). O restante da interface usa a fonte sem serifa do sistema. O projeto só usa fontes gratuitas.
