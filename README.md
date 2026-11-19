# Moneta

Aplicação local de usuário único para conectar instituições via Pluggy. A implementação usa Node.js e SQLite, com interface em português.

## Execução com Docker Compose

Na raiz do projeto, prepare a pasta de dados e suba o serviço:

```sh
mkdir -p -m 700 data
docker compose up -d --build
```

Abra http://127.0.0.1:4173. Em **Configuração**, informe o Client ID e o Client Secret da sua aplicação Pluggy e clique em **Validar e salvar**. O Compose monta `./data` para preservar as credenciais e os dados financeiros. Se a execução direta já estiver ativa, encerre-a antes de subir o container na mesma porta. Use `docker compose down` para parar.

O serviço roda com UID/GID 1000 por padrão. Em Linux com outros IDs, defina `MONETA_UID` e `MONETA_GID` no `.env` com os valores de `id -u` e `id -g`.

## Execução direta com Node.js

Use Node.js 22.16 ou superior. Na raiz do projeto:

```sh
node --env-file-if-exists=.env server.mjs
```

Abra http://127.0.0.1:4173. Cadastre as credenciais em **Configuração**. Elas entram em vigor assim que a Pluggy as valida. O botão **Reiniciar servidor** reinicia o processo que atende a aplicação tanto no Docker quanto na execução direta. A conexão requer internet para a API e o widget. O servidor escuta somente no loopback.

## Dados e integração

O banco local em data/moneta.sqlite guarda o perfil, vínculos, saldos, investimentos, lançamentos, categorias e regras. Preserve esse arquivo entre execuções. GET /api/connections fornece a lista local em JSON para uma futura integração com a Ayla. O servidor guarda as credenciais cadastradas em `data/pluggy.json`, com permissão de leitura e escrita apenas para o proprietário. Proteja as cópias dessa pasta, pois o arquivo contém o segredo em texto simples. Instalações com credenciais no ambiente continuam a usá-las até que um novo par seja salvo pela interface.

## Telas financeiras

Para uma conexão existente, use **Sincronizar**. A Moneta busca o histórico disponível na Pluggy e grava a nova posição após concluir a leitura das páginas de todas as conexões. Uma falha preserva a consulta anterior. A sincronização também ocorre ao conectar uma nova instituição.

- **Relatório mensal** reúne receitas, despesas, resultado e despesas por categoria dos lançamentos efetivados. A data usada é a do lançamento. O seletor de moeda mantém cada moeda separada.
- **Patrimônio** usa a posição da última sincronização. O bruto soma saldos positivos e investimentos brutos. O líquido considera investimentos líquidos e desconta dívidas de cartões e saldos bancários negativos. A parcela de aplicação automática é descontada do saldo bancário para evitar dupla contagem. Valores ausentes aparecem como indisponíveis.
- **Transações** permite buscar a descrição, filtrar por conta ou categoria e alterar a classificação. Selecione Automática para devolver uma transação às regras.
- **Cartões** mostra cada conta de crédito com seus lançamentos do mês, saldo usado atual e limite informado.
- **Categorias e regras** permitem criar categorias personalizadas e associá-las a trechos da descrição. A classificação manual precede a primeira regra correspondente e depois a categoria reconhecida da Pluggy. Classifique transferências próprias, pagamentos de fatura e movimentações de investimentos nas categorias internas para excluí-los do fluxo mensal.
