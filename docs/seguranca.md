# Segurança do Moneta

O Moneta guarda dados financeiros e a chave de acesso à Pluggy. Este documento diz do que ele se protege, o que já está feito, o que ainda fica exposto e o que vem a seguir. A base é o artigo [Adicionando segurança de verdade nos seus apps GUI Linux vibecoded](https://akitaonrails.com/2026/11/06/adicionando-seguranca-de-verdade-nos-seus-apps-gui-linux-vibecoded/), adaptado a um app diferente do dele: o Moneta é um servidor HTTP local com interface no navegador, roda em Linux, Windows e Docker, e fica ligado em segundo plano para sincronizar sozinho.

## Do que o Moneta se protege

| Ameaça | Proteção |
| --- | --- |
| Outro usuário do mesmo computador lendo a API em `127.0.0.1` | Chave de acesso por instalação, trocada por um cookie `HttpOnly`; sem ela a API responde 401 |
| Outro usuário lendo os arquivos | Pasta de dados `0700` e arquivos `0600`, corrigidos a cada início; `umask 077` no processo |
| Site aberto no navegador mandando ações para o Moneta (CSRF) | Cookie `SameSite=Strict` e conferência do cabeçalho `Origin` em toda escrita |
| Site que aponta um domínio próprio para `127.0.0.1` (DNS rebinding) | Conferência do cabeçalho `Host`: só `localhost` e `127.0.0.1` |
| Página do Moneta embutida em outro site (clickjacking) | `frame-ancestors 'none'` e `X-Frame-Options: DENY` |
| Script injetado rodando na página | CSP sem scripts embutidos: só os arquivos do próprio Moneta e o widget da Pluggy |
| Cópia do disco, do backup ou da pasta de dados levando o Client Secret | No Linux, credenciais lacradas com `systemd-creds --user` (TPM 2.0 quando existe); no Windows, DPAPI do usuário |
| Dados apagados que continuam no arquivo do banco | `PRAGMA secure_delete = ON` |
| Arquivo de banco adulterado executando funções ou gatilhos | `PRAGMA trusted_schema = OFF` |
| Tabelas temporárias de consultas indo parar no disco | `PRAGMA temp_store = MEMORY` |

## Como funciona o acesso

1. Na primeira execução, o Moneta cria `acesso.key` na pasta de dados: 32 bytes aleatórios, permissão `0600`.
2. O atalho do menu, o comando `moneta` e o instalador do Windows abrem `http://127.0.0.1:4173/entrar?chave=…`.
3. O servidor confere a chave em tempo constante, grava o cookie `moneta_acesso` (`HttpOnly`, `SameSite=Strict`) e redireciona para `/`, tirando a chave do endereço e do histórico.
4. Daí em diante o endereço normal funciona direto nesse navegador. Sem o cookie, a página mostra como entrar.

No Docker e no Node direto não há atalho: o endereço de entrada sai no log ao iniciar (`docker compose logs moneta`).

Para invalidar todos os navegadores autorizados, apague `acesso.key` e reinicie o Moneta.

## Credenciais da Pluggy

- **Linux:** `systemd-creds --user encrypt --name=moneta-pluggy` grava `pluggy.cred`. O arquivo só abre para o mesmo usuário, no mesmo computador quando há TPM, e com o mesmo nome de credencial. Não é preciso senha de administrador.
- **Windows:** `pluggy.dpapi`, protegido pela DPAPI do usuário atual.
- **Docker ou sem nenhum dos dois:** `pluggy.json` com permissão `0600`. As variáveis `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` continuam valendo.

Um `pluggy.json` antigo é lacrado automaticamente no primeiro início em que o lacre está disponível. O texto puro só é apagado depois de o Moneta abrir o lacre e conferir o conteúdo. A página Configuração mostra qual proteção está em uso.

Para forçar o arquivo comum (por exemplo, para testes), use `MONETA_SECRET_STORE=arquivo`.

## O que ainda fica exposto

Estes riscos são conhecidos e aceitos por enquanto:

- **Processos do mesmo usuário.** Um programa malicioso rodando com o seu usuário consegue ler `acesso.key`, abrir o lacre das credenciais (o `systemd-creds --user` abre para qualquer processo do usuário) e ler o banco. O artigo resolve isso pedindo a senha do sistema a cada abertura (Polkit) e fechando o cofre após 15 minutos parado. Isso é incompatível com o Moneta ligado em segundo plano sincronizando sozinho, e fica como opção futura.
- **Banco em texto puro dentro da pasta protegida.** As permissões impedem outros usuários de ler, mas uma cópia da pasta (backup, disco removido) leva os lançamentos legíveis. As credenciais não vão junto, porque estão lacradas.
- **Root ou o kernel comprometido** quebram qualquer proteção enquanto o Moneta está ligado.
- **SSD e sistemas copy-on-write** (Btrfs) podem guardar blocos antigos depois que um arquivo é apagado ou sobrescrito, inclusive do `pluggy.json` migrado.
- **Windows:** a proteção por DPAPI foi escrita, mas ainda não foi testada num Windows real. Se o lacre falhar, o Moneta volta ao arquivo `0600`.

## Próximos passos

1. **Banco criptografado.** O `node:sqlite` não suporta SQLCipher. As opções são criptografar os blocos de dados financeiros na aplicação (AES-256-GCM, com a chave lacrada como as credenciais) ou trocar para uma biblioteca com SQLCipher, o que traz uma dependência nativa. A migração deve seguir o artigo: checkpoint, backup `0600`, impressão digital SHA-256 do conteúdo antes e depois, e troca atômica só se tudo bater.
2. **Serviço do systemd endurecido.** Extrair o AppImage na instalação para dispensar o FUSE e então ligar `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only` com escrita só na pasta de dados, `PrivateTmp`, `RestrictAddressFamilies`, `LimitCORE=0` e `UMask=0077`.
3. **Backups verificados.** Exportação com manifesto, HMAC e teste de restauração logo após criar, como o `.mbbackup` do artigo.
4. **Modo cofre (opcional).** Pedir a senha do sistema para abrir o Moneta e fechar após um tempo parado, para quem abrir mão da sincronização em segundo plano.
5. **Teste no Windows** do lacre por DPAPI.
