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
| Cópia do disco, do backup ou da pasta de dados levando os lançamentos | Banco inteiro cifrado com AES-256-GCM em `moneta.cofre`; nada do banco fica legível em disco, nem o esquema |
| Cópia do disco, do backup ou da pasta de dados levando o Client Secret ou a chave do banco | No Linux, segredos lacrados com `systemd-creds --user` (TPM 2.0 quando existe); no Windows, DPAPI do usuário |
| Arquivo do banco adulterado ou corrompido | A tag do AES-GCM impede abrir um cofre alterado; uma gravação interrompida cai para `moneta.cofre.anterior` |
| Arquivo de banco adulterado executando funções ou gatilhos | `PRAGMA trusted_schema = OFF` |
| Tabelas temporárias de consultas indo parar no disco | Banco só na memória e `PRAGMA temp_store = MEMORY` |
| Memória do Moneta, com os dados abertos, gravada em disco numa queda | Serviço do systemd com `LimitCORE=0` |

## Como funciona o acesso

1. Na primeira execução, o Moneta cria `acesso.key` na pasta de dados: 32 bytes aleatórios, permissão `0600`.
2. O atalho do menu, o comando `moneta` e o instalador do Windows abrem `http://127.0.0.1:4173/entrar?chave=…`.
3. O servidor confere a chave em tempo constante, grava o cookie `moneta_acesso` (`HttpOnly`, `SameSite=Strict`) e redireciona para `/`, tirando a chave do endereço e do histórico.
4. Daí em diante o endereço normal funciona direto nesse navegador. Sem o cookie, a página mostra como entrar.

No Docker e no Node direto não há atalho: o endereço de entrada sai no log ao iniciar (`docker compose logs moneta`).

Para invalidar todos os navegadores autorizados, apague `acesso.key` e reinicie o Moneta.

## Banco cifrado (o cofre)

O `node:sqlite` do Node.js não suporta SQLCipher, e o projeto não usa dependências externas. Por isso o Moneta cifra o banco inteiro na própria aplicação, só com `node:sqlite`, `node:crypto` e `node:zlib`:

- **Durante o uso**, o SQLite roda em `:memory:`. Nenhum arquivo do banco em texto puro existe em disco.
- **No disco** fica só `moneta.cofre`: esquema e linhas exportados em JSON (preservando inteiros grandes e BLOBs), comprimidos com gzip e cifrados com AES-256-GCM. O formato é `MONETA\0` + versão + nonce de 12 bytes + texto cifrado + tag de 16 bytes. O cabeçalho é autenticado e cada gravação usa um nonce novo.
- **Gravação:** depois de cada alteração confirmada (antes de responder ao navegador), ao fim de cada sincronização, a cada 15 segundos se houver mudança e ao receber `SIGTERM`, `SIGINT` ou `SIGHUP`. A gravação é atômica (arquivo temporário `0600`, `fsync` e `rename`), e a versão anterior fica em `moneta.cofre.anterior`.
- **Chave:** 32 bytes aleatórios, lacrados como as credenciais (`banco.cred` ou `banco.dpapi`). A chave é lacrada antes de qualquer gravação, então nunca existe um cofre sem a chave guardada.
- **Migração** de um `moneta.sqlite` antigo, como no artigo: `wal_checkpoint(TRUNCATE)`, impressão digital SHA-256 de esquema e linhas, cofre gravado e relido do disco, impressão digital de novo. O texto puro (inclusive `-wal` e `-shm`) só é sobrescrito e apagado se as duas baterem.

### Chave de recuperação

A chave do cofre em Base32, com 2 bytes de SHA-256 para pegar erros de digitação: `MONETA-XXXXX-…`. A página Configuração mostra a chave até você confirmar que a guardou. Depois disso ela não aparece mais: para ter uma nova, use **Gerar nova chave de recuperação**, que troca a chave do cofre e invalida a anterior, inclusive na gravação anterior.

Se a chave lacrada não abrir (TPM apagado numa atualização de BIOS, dados levados para outro computador), o Moneta sobe trancado e pede a chave de recuperação. Ela abre o cofre e é lacrada de novo no computador atual.

## Credenciais da Pluggy

- **Linux:** `systemd-creds --user encrypt --name=moneta-pluggy` grava `pluggy.cred`. O arquivo só abre para o mesmo usuário, no mesmo computador quando há TPM, e com o mesmo nome de credencial. Não é preciso senha de administrador.
- **Windows:** `pluggy.dpapi`, protegido pela DPAPI do usuário atual.
- **Docker ou sem nenhum dos dois:** `pluggy.json` com permissão `0600`. As variáveis `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` continuam valendo.

Um `pluggy.json` antigo é lacrado automaticamente no primeiro início em que o lacre está disponível. O texto puro só é apagado depois de o Moneta abrir o lacre e conferir o conteúdo. A página Configuração mostra qual proteção está em uso.

Para forçar o arquivo comum (por exemplo, para testes), use `MONETA_SECRET_STORE=arquivo`.

## O que ainda fica exposto

Estes riscos são conhecidos e aceitos por enquanto:

- **Processos do mesmo usuário.** Um programa malicioso rodando com o seu usuário consegue ler `acesso.key`, abrir o lacre das credenciais (o `systemd-creds --user` abre para qualquer processo do usuário) e ler o banco. O artigo resolve isso pedindo a senha do sistema a cada abertura (Polkit) e fechando o cofre após 15 minutos parado. Isso é incompatível com o Moneta ligado em segundo plano sincronizando sozinho, e fica como opção futura.
- **Docker:** sem `systemd-creds` dentro do container, a chave do cofre fica em `banco.key`, ao lado do cofre. Uma cópia da pasta `data/` leva os dois. No Docker, a proteção do banco depende das permissões do volume.
- **Banco na memória** enquanto o Moneta está ligado: um processo com acesso à memória do Moneta (o mesmo usuário com ptrace, ou root) consegue ler os dados.
- **Backups antigos em texto puro**, feitos antes do cofre, continuam legíveis até serem apagados.
- **Root ou o kernel comprometido** quebram qualquer proteção enquanto o Moneta está ligado.
- **SSD e sistemas copy-on-write** (Btrfs) podem guardar blocos antigos depois que um arquivo é apagado ou sobrescrito, inclusive do `pluggy.json` migrado.
- **Windows:** a proteção por DPAPI foi escrita, mas ainda não foi testada num Windows real. Se o lacre falhar, o Moneta volta ao arquivo `0600`.

## Próximos passos

1. **Serviço do systemd endurecido.** Extrair o AppImage na instalação para dispensar o FUSE e então ligar `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only` com escrita só na pasta de dados, `PrivateTmp`, `RestrictAddressFamilies`. (`LimitCORE=0` e `UMask=0077` já estão no serviço.)
2. **Backups verificados.** Exportação com manifesto, HMAC e teste de restauração logo após criar, como o `.mbbackup` do artigo.
3. **Modo cofre (opcional).** Pedir a senha do sistema para abrir o Moneta e fechar após um tempo parado, para quem abrir mão da sincronização em segundo plano.
4. **Teste no Windows** do lacre por DPAPI.
