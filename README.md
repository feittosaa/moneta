# Moneta

Aplicação local de usuário único para conectar instituições via Pluggy. A implementação usa Node.js e SQLite, com interface em português.

## Execução

Use Node.js 22.16 ou superior. Na raiz do projeto:

```sh
cp -n .env.example .env
node --env-file=.env server.mjs
```

Abra http://127.0.0.1:4173. Para conectar uma instituição, preencha as duas variáveis do arquivo .env com as credenciais da sua aplicação Pluggy e reinicie o servidor. A conexão requer internet para a API e o widget. O servidor escuta somente no loopback.

## Dados e integração

O banco local em data/moneta.sqlite guarda o perfil, vínculos, saldos, investimentos, lançamentos, categorias e regras. Preserve esse arquivo entre execuções. GET /api/connections fornece a lista local em JSON para uma futura integração com a Ayla. As chaves de API são usadas somente no servidor.

## Telas financeiras

Para uma conexão existente, use **Sincronizar**. A Moneta busca o histórico disponível na Pluggy e grava a nova posição após concluir a leitura das páginas de todas as conexões. Uma falha preserva a consulta anterior. A sincronização também ocorre ao conectar uma nova instituição.

- **Relatório mensal** reúne receitas, despesas, resultado e despesas por categoria dos lançamentos efetivados. A data usada é a do lançamento. O seletor de moeda mantém cada moeda separada.
- **Patrimônio** usa a posição da última sincronização. O bruto soma saldos positivos e investimentos brutos. O líquido considera investimentos líquidos e desconta dívidas de cartões e saldos bancários negativos. A parcela de aplicação automática é descontada do saldo bancário para evitar dupla contagem. Valores ausentes aparecem como indisponíveis.
- **Transações** permite buscar a descrição, filtrar por conta ou categoria e alterar a classificação. Selecione Automática para devolver uma transação às regras.
- **Cartões** mostra cada conta de crédito com seus lançamentos do mês, saldo usado atual e limite informado.
- **Categorias e regras** permitem criar categorias personalizadas e associá-las a trechos da descrição. A classificação manual precede a primeira regra correspondente e depois a categoria reconhecida da Pluggy. Classifique transferências próprias, pagamentos de fatura e movimentações de investimentos nas categorias internas para excluí-los do fluxo mensal.
