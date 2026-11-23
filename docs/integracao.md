# Integração com outros programas (Ayla)

A Moneta é um produto separado. Programas locais, como a Ayla, conversam com ela por este contrato e não acessam o banco diretamente: o banco fica cifrado em `moneta.cofre` e só a Moneta o abre. Os dados continuam pertencendo à Moneta. Quem consome a API não deve guardar cópias sem uma decisão explícita sobre isso.

Versão do contrato: **1**. Ela aparece no campo `api` de `GET /api/status`.

## Encontrar e abrir a Moneta

| | Linux | Windows |
| --- | --- | --- |
| Executável | `~/.local/bin/moneta` | `%LOCALAPPDATA%\Programs\Moneta\moneta.exe` |
| Pasta de dados | `$XDG_DATA_HOME/moneta` (padrão `~/.local/share/moneta`) | `%LOCALAPPDATA%\Moneta` |
| Endereço | `http://127.0.0.1:4173` | `http://127.0.0.1:4173` |

- No Windows, `moneta.exe` é a janela nativa (Tauri). Rodar de novo com ela aberta só mostra a janela existente (instância única), então a Ayla pode usar o mesmo comando para "abrir a Moneta". Com `--background`, ele sobe o servidor e fica só na bandeja.
- No Linux, o servidor normalmente já roda como serviço do systemd. Rodar `moneta` abre o painel no navegador.
- Atualização pela página da Moneta mostrada na Ayla: como o pedido chega com `Authorization: Bearer`, a Moneta atualizada volta só em segundo plano (pelo serviço do systemd, se houver, ou com `--background`; no Windows, na bandeja), sem abrir uma janela separada. Pela janela ou pelo navegador, ela reabre a janela.
- Para saber se a Moneta está no ar: `GET /api/status`, sem autenticação, responde `{ "api": 1, "instance": "…", "desktop": true, "locked": false, "lock": null }`.

## Autenticação

Toda a API, menos `/api/status`, exige a chave de acesso da instalação: o conteúdo de `acesso.key`, na pasta de dados (43 caracteres base64url, legível só pelo dono). Envie a chave em um cabeçalho:

```
Authorization: Bearer <conteúdo de acesso.key>
```

Ler a chave exige estar logado com o mesmo usuário do sistema. Sem a chave, ou com uma chave errada, a resposta é `401`. Navegadores usam o cookie `moneta_acesso`, e um site não consegue mandar o cabeçalho `Authorization` para a Moneta, porque ele não libera CORS.

## Leitura

| Rota | Conteúdo |
| --- | --- |
| `GET /api/status` | Com a chave: também `updated` (última sincronização, ISO 8601) e `authorized: true` |
| `GET /api/finance` | Visão completa: `currency`, `accounts`, `transactions`, `bills`, `categories`, `rules`, `vouchers`, `holdings`, `sources`, `catalogRules` |
| `GET /api/portfolio` | Histórico de patrimônio: lista de `{ item, day, accounts, holdings }` |
| `GET /api/connections` | Instituições conectadas e se as credenciais da Pluggy estão configuradas |
| `GET /api/resumo` | Resumo pronto para assistentes: `accounts` (saldos), `cards` (com `openInvoice`, a mesma "Fatura em aberto" da Visão geral, e `upcomingBills`), `totals` do mês por moeda (`income`, `spent`, `result`, `invoices`, `openInvoices`, `netWorth`), `months` (até 12 meses, do mais antigo ao atual, só os com movimento: `month`, `currency`, `income`, `spent` e `categories`, a lista `{ name, amount }` das despesas por categoria, que soma `spent`; compras no cartão entram pela fatura do mês, e a parte sem detalhamento aparece como "Fatura sem detalhamento"), os 20 lançamentos mais recentes em `recent`, `today` e `connected` |

Formatos:

- Valores em **centavos**, inteiros e com sinal: despesa negativa, receita positiva.
- Datas em `AAAA-MM-DD`.
- Moeda em código ISO 4217, em `currency` de cada item.
- Transação: `id`, `account`, `date`, `description`, `amount`, `currency`, `pending`, `category`, `providerCategory`, `note`, `manual`.
- Conta: `id`, `institution`, `name`, `type` (`BANK`, `CREDIT`, `CASH`…), `subtype`, `balance`, `currency`, `last4`.

## Estados que a integração precisa tratar

| Resposta | Significado | O que fazer |
| --- | --- | --- |
| Sem conexão em `127.0.0.1:4173` | Moneta desligada | Oferecer abrir a Moneta |
| `401` | Chave ausente ou errada | Reler `acesso.key`; a chave muda se alguém apagar o arquivo |
| `423` com `lock: "senha"` em `/api/status` | Modo cofre ligado e a Moneta trancada | Abrir a Moneta para a pessoa digitar a senha; nunca pedir ou guardar a senha |
| `423` com `lock: "chave"` | O cofre precisa da chave de recuperação | Abrir a Moneta |
| `503` | Reiniciando | Tentar de novo em instantes |

## Escrita

As rotas `POST` existem para a interface da Moneta e podem mudar sem aviso. Além da chave, elas exigem `Content-Type: application/json` e `Origin: http://127.0.0.1:4173`. Por enquanto, a integração deve ser só de leitura. Escritas entram no contrato quando houver um caso de uso acordado.
