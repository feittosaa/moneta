# Segurança da Moneta

A Moneta guarda dados financeiros e a chave de acesso à Pluggy. Este documento diz do que ela se protege, o que já está feito, o que ainda fica exposto e o que vem a seguir. A base é o artigo [Adicionando segurança de verdade nos seus apps GUI Linux vibecoded](https://akitaonrails.com/2026/11/06/adicionando-seguranca-de-verdade-nos-seus-apps-gui-linux-vibecoded/), adaptado a um app diferente do dele: a Moneta é um servidor HTTP local com interface no navegador, roda em Linux, Windows e Docker, e fica ligado em segundo plano para sincronizar sozinho.

## Do que a Moneta se protege

| Ameaça | Proteção |
| --- | --- |
| Outro usuário do mesmo computador lendo a API em `127.0.0.1` | Chave de acesso por instalação, trocada por um cookie `HttpOnly`; sem ela a API responde 401 |
| Outro usuário lendo os arquivos | Pasta de dados `0700` e arquivos `0600`, corrigidos a cada início; `umask 077` no processo |
| Site aberto no navegador mandando ações para a Moneta (CSRF) | Cookie `SameSite=Strict` e conferência do cabeçalho `Origin` em toda escrita |
| Site que aponta um domínio próprio para `127.0.0.1` (DNS rebinding) | Conferência do cabeçalho `Host`: só `localhost` e `127.0.0.1` |
| Página da Moneta embutida em outro site (clickjacking) | `frame-ancestors 'none'` e `X-Frame-Options: DENY` |
| Script injetado rodando na página | CSP sem scripts embutidos: só os arquivos do própria Moneta e o widget da Pluggy |
| Cópia do disco, do backup ou da pasta de dados levando os lançamentos | Banco inteiro cifrado com AES-256-GCM em `moneta.cofre`; nada do banco fica legível em disco, nem o esquema |
| Cópia do disco, do backup ou da pasta de dados levando o Client Secret ou a chave do banco | No Linux, segredos lacrados com `systemd-creds --user` (TPM 2.0 quando existe); no Windows, DPAPI do usuário |
| Arquivo do banco adulterado ou corrompido | A tag do AES-GCM impede abrir um cofre alterado; uma gravação interrompida cai para `moneta.cofre.anterior` |
| Arquivo de banco adulterado executando funções ou gatilhos | `PRAGMA trusted_schema = OFF` |
| Tabelas temporárias de consultas indo parar no disco | Banco só na memória e `PRAGMA temp_store = MEMORY` |
| Memória da Moneta, com os dados abertos, gravada em disco numa queda | Serviço do systemd com `LimitCORE=0` |
| Falha na Moneta (ou numa dependência futura) usada para mexer no resto do sistema | Serviço do systemd em sandbox: só escreve na pasta de dados, sem novos privilégios, sem dispositivos, `/tmp` próprio, chamadas de sistema filtradas |
| Perda do computador, do disco ou um erro que estrague os dados | Backups diários cifrados e testados, e backup para baixar e guardar fora |
| Programa malicioso rodando com o seu usuário (com o modo cofre ligado e a Moneta trancada) | Chave do cofre cifrada com uma senha (scrypt) além do lacre do sistema; trancamento automático por inatividade |

## Como funciona o acesso

1. Na primeira execução, a Moneta cria `acesso.key` na pasta de dados: 32 bytes aleatórios, permissão `0600`.
2. O atalho do menu, o comando `moneta` e o instalador do Windows abrem `http://127.0.0.1:4173/entrar?chave=…`.
3. O servidor confere a chave em tempo constante, grava o cookie `moneta_acesso` (`HttpOnly`, `SameSite=Strict`) e redireciona para `/`, tirando a chave do endereço e do histórico.
4. Daí em diante o endereço normal funciona direto nesse navegador. Sem o cookie, a página mostra como entrar.

No Docker e no Node direto não há atalho: o endereço de entrada sai no log ao iniciar (`docker compose logs moneta`).

Programas locais (a janela nativa do Windows, a Ayla) mandam a mesma chave em `Authorization: Bearer`. Um site aberto no navegador não consegue enviar esse cabeçalho à Moneta, porque o servidor não libera CORS. A chave continua exigindo acesso à pasta de dados, ou seja, o mesmo usuário do sistema.

Para invalidar todos os navegadores autorizados, apague `acesso.key` e reinicie a Moneta.

## Banco cifrado (o cofre)

O `node:sqlite` do Node.js não suporta SQLCipher, e o projeto não usa dependências externas. Por isso a Moneta cifra o banco inteiro na própria aplicação, só com `node:sqlite`, `node:crypto` e `node:zlib`:

- **Durante o uso**, o SQLite roda em `:memory:`. Nenhum arquivo do banco em texto puro existe em disco.
- **No disco** fica só `moneta.cofre`: esquema e linhas exportados em JSON (preservando inteiros grandes e BLOBs), comprimidos com gzip e cifrados com AES-256-GCM. O formato é `MONETA\0` + versão + nonce de 12 bytes + texto cifrado + tag de 16 bytes. O cabeçalho é autenticado e cada gravação usa um nonce novo.
- **Gravação:** depois de cada alteração confirmada (antes de responder ao navegador), ao fim de cada sincronização, a cada 15 segundos se houver mudança e ao receber `SIGTERM`, `SIGINT` ou `SIGHUP`. A gravação é atômica (arquivo temporário `0600`, `fsync` e `rename`), e a versão anterior fica em `moneta.cofre.anterior`.
- **Chave:** 32 bytes aleatórios, lacrados como as credenciais (`banco.cred` ou `banco.dpapi`). A chave é lacrada antes de qualquer gravação, então nunca existe um cofre sem a chave guardada.
- **Migração** de um `moneta.sqlite` antigo, como no artigo: `wal_checkpoint(TRUNCATE)`, impressão digital SHA-256 de esquema e linhas, cofre gravado e relido do disco, impressão digital de novo. O texto puro (inclusive `-wal` e `-shm`) só é sobrescrito e apagado se as duas baterem.

### Chave de recuperação

A chave do cofre em Base32, com 2 bytes de SHA-256 para pegar erros de digitação: `MONETA-XXXXX-…`. A página Configuração mostra a chave até você confirmar que a guardou. Depois disso ela não aparece mais: para ter uma nova, use **Gerar nova chave de recuperação**, que troca a chave do cofre e invalida a anterior, inclusive na gravação anterior.

Se a chave lacrada não abrir (TPM apagado numa atualização de BIOS, dados levados para outro computador), a Moneta sobe trancada e pede a chave de recuperação. Ela abre o cofre e é lacrada de novo no computador atual.

## Backups

A Moneta faz um backup por dia em `backups/`, dentro da pasta de dados, e guarda os 7 mais recentes. Em **Configuração → Backups** dá para baixar um backup na hora e restaurar de um arquivo ou de um dos automáticos.

- **Formato** (`.monetabackup`): `MONETA-BACKUP\0` + versão + cabeçalho JSON legível (só a data e um identificador da chave) + nonce + conteúdo cifrado com AES-256-GCM + tag. Dentro vão o manifesto (data, resumo com contagens e a impressão digital SHA-256 do banco) e o banco inteiro.
- **Integridade:** o cabeçalho entra como dado autenticado, então a tag do AES-GCM cobre o arquivo inteiro. Ela faz o papel do HMAC do `.mbbackup` do artigo: qualquer byte trocado impede a abertura.
- **Teste de restauração:** todo backup é aberto e remontado na memória logo depois de criado, e a impressão digital do resultado tem que bater com a do manifesto. Os automáticos são testados de novo depois de gravados, relendo do disco; um arquivo que não passa é apagado.
- **Chave:** o backup usa a chave do cofre do dia em que foi feito, ou seja, abre com a chave de recuperação que valia naquele dia. Ao gerar uma nova chave de recuperação, os backups automáticos são cifrados de novo com a nova; os baixados continuam abrindo com a antiga, e a Moneta pede essa chave ao restaurar.
- **Restauração:** a Moneta abre e testa o arquivo, mostra a data e o resumo para você conferir e, só depois da confirmação, guarda um backup automático do estado atual e troca o banco.

## Modo cofre

Opcional, em **Configuração → Modo cofre**. Com ele ligado:

- A chave do cofre é cifrada com uma chave derivada da sua senha (scrypt, N = 2¹⁷, r = 8, 128 MiB por tentativa) e o resultado ainda é lacrado pelo sistema em `banco-senha.cred`. Abrir exige este computador **e** a senha.
- Ligar troca a chave do cofre. Assim, uma cópia de `banco.cred` feita antes deixa de abrir o banco. A nova chave de recuperação aparece na hora.
- A Moneta sobe trancada (inclusive o serviço que liga com o sistema) e tranca de novo depois de 5 minutos a 4 horas sem uso. Trancar reinicia o processo, então nada do banco aberto fica na memória. A página recarrega e some com os dados da tela.
- Depois de 3 senhas erradas, cada nova tentativa espera mais (até 5 minutos).
- Esqueceu a senha? A chave de recuperação abre o cofre e desliga o modo cofre, que pode ser ligado de novo com outra senha.
- Enquanto estiver trancada, a sincronização automática fica parada.

A senha é do própria Moneta, não a do sistema. O artigo usa o Polkit para pedir a senha do sistema, mas o Polkit só autoriza: não gera uma chave, então o banco continuaria abrindo sem a senha para quem conseguisse falar com o lacre. A senha da Moneta participa da cifra, funciona igual no Linux e no Windows e não depende de um agente do Polkit na sessão.

### Desbloqueio pela biometria

Opcional, no Android e na Moneta Web, só com o modo cofre ligado. A senha continua participando da cifra: o aparelho guarda uma cópia dela, cifrada por uma chave que só funciona depois da verificação do usuário.

- **Android:** chave AES-256-GCM no Android Keystore, não exportável, exigida a cada uso (digital ou rosto de classe forte; no Android 11 ou mais novo, também o bloqueio de tela). A chave é invalidada quando uma digital nova é cadastrada. Antes de guardar, o servidor confere a senha em `/api/vault/password/check`, com o mesmo limite de tentativas de `/api/unlock`. A ponte com o JavaScript só responde à página da própria Moneta.
- **Moneta Web:** passkey do aparelho com a extensão PRF do WebAuthn e verificação do usuário obrigatória. O segredo PRF passa por HKDF-SHA-256 e vira a chave AES-GCM que cifra a senha. O registro fica no IndexedDB, fora do cofre e dos backups. A passkey fica presa ao domínio da Moneta Web.
- Desligar o modo cofre, trocar a senha, usar a chave de recuperação ou restaurar um backup na Moneta Web apaga o registro. Uma senha guardada que não abre mais o cofre também é apagada na primeira tentativa.
- Quem desbloqueia o aparelho consegue abrir a Moneta. Use um código do aparelho forte.

## Serviço do systemd

O comando de instalação extrai o AppImage em `~/.local/lib/moneta`, o que dispensa o FUSE, e o serviço `moneta.service` roda em sandbox:

`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only` com escrita só em `~/.local/share/moneta`, `PrivateTmp`, `PrivateDevices`, `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectKernelLogs`, `ProtectControlGroups`, `ProtectClock`, `ProtectHostname`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK` (o netlink só serve para listar os IPs da máquina, que o QR de vínculo precisa), `RestrictNamespaces`, `RestrictRealtime`, `RestrictSUIDSGID`, `LockPersonality`, `SystemCallArchitectures=native`, `SystemCallFilter=@system-service`, `LimitCORE=0` e `UMask=0077`.

O `systemd-creds` continua funcionando de dentro do sandbox, porque fala com o serviço de credenciais do systemd por um socket local. A nota do `systemd-analyze --user security moneta` é 4,1 (OK). `MemoryDenyWriteExecute` fica de fora porque o JIT do Node.js precisa dele.

## Credenciais da Pluggy

- **Linux:** `systemd-creds --user encrypt --name=moneta-pluggy` grava `pluggy.cred`. O arquivo só abre para o mesmo usuário, no mesmo computador quando há TPM, e com o mesmo nome de credencial. Não é preciso senha de administrador.
- **Windows:** `pluggy.dpapi`, protegido pela DPAPI do usuário atual.
- **Docker ou sem nenhum dos dois:** `pluggy.json` com permissão `0600`. As variáveis `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` continuam valendo.

Um `pluggy.json` antigo é lacrado automaticamente no primeiro início em que o lacre está disponível. O texto puro só é apagado depois de a Moneta abrir o lacre e conferir o conteúdo. A página Configuração mostra qual proteção está em uso.

Para forçar o arquivo comum (por exemplo, para testes), use `MONETA_SECRET_STORE=arquivo`.

## Sincronização entre aparelhos

- **Rede:** só aceita conexões de IPv4 privado e só enquanto a Moneta está aberta e destrancada. Cada vínculo tem chave própria, criada no primeiro contato a partir do convite do QR, que vale por dois minutos. Cada troca exige um desafio novo, é autenticada por HMAC-SHA256 e vai cifrada com AES-256-GCM.
- **Moneta Web:** o servidor HTTPS da porta 4175 só responde a páginas da origem publicada (`https://feittosaa.github.io` ou `MONETA_WEB_ORIGIN`) e só no endereço local do próprio aparelho.
- **Autoridade de certificados local:** cada instalação cria uma autoridade ECDSA P-256, cuja chave fica lacrada como as credenciais da Pluggy (`autoridade-local`). O certificado dela tem `nameConstraints` crítico: só vale para IPs de 10/8, 172.16/12 e 192.168/16, e nomes DNS, e-mails e URIs ficam presos a `moneta.invalid`. Quem copiar a chave não consegue emitir um certificado aceito para um site da internet. O certificado do servidor dura um ano, é refeito a cada início ou troca de IP e só serve para autenticação de servidor.
- **Senha na primeira abertura:** a instalação nova manda a senha digitada pelo canal cifrado do vínculo, e a Moneta de origem só confere se ela abre o próprio cofre, sem devolver a chave. A conferência só é aceita nos 10 minutos seguintes ao vínculo e segue a espera crescente do desbloqueio. A chave do cofre nunca sai do aparelho.
- **Perfil do iPhone:** é entregue em HTTP pela rede local, apenas nos 10 minutos depois de o usuário escolher **iPhone ou iPad** na tela de vínculo. Ele contém só o certificado público.
- **Credenciais da Pluggy na Moneta Web:** só são aceitas com o modo cofre ligado e ficam dentro do banco cifrado (PBKDF2-SHA256 com 600 mil iterações e AES-256-GCM). Desligar o modo cofre as apaga. Backups exportados não levam credenciais nem vínculos.

## Atualização pelo app

- **Linux, Windows e Android:** a Moneta consulta a última release do GitHub, baixa o instalador da plataforma e só segue se o SHA-256 bater com o `SHA256SUMS.txt` da mesma release.
- **Android:** o servidor só baixa e confere o APK. Quem instala é o instalador do sistema, que pede confirmação e recusa um APK assinado com outra chave. A resposta do instalador volta para a tela da Moneta com um código aleatório criado a cada instalação, para que outro app não consiga se passar por ela.
- **Moneta Web:** o service worker baixa a versão publicada no GitHub Pages ao abrir e a aplica com o cofre trancado ou quando a pessoa volta ao app.

## O que ainda fica exposto

Estes riscos são conhecidos e aceitos por enquanto:

- **Processos do mesmo usuário.** Sem o modo cofre, um programa malicioso rodando com o seu usuário consegue ler `acesso.key`, abrir o lacre das credenciais (o `systemd-creds --user` abre para qualquer processo do usuário) e ler o banco. Com o modo cofre, isso só vale enquanto a Moneta estiver destrancado; trancado, falta a senha. Um programa assim ainda pode capturar a senha pelo teclado. As credenciais da Pluggy continuam só com o lacre do sistema, porque a sincronização precisa delas.
- **Docker:** sem `systemd-creds` dentro do container, a chave do cofre fica em `banco.key`, ao lado do cofre. Uma cópia da pasta `data/` leva os dois. No Docker, a proteção do banco depende das permissões do volume, a menos que o modo cofre esteja ligado: aí a chave depende também da senha.
- **Banco na memória** enquanto a Moneta está ligada: um processo com acesso à memória da Moneta (o mesmo usuário com ptrace, ou root) consegue ler os dados.
- **Backups antigos em texto puro**, feitos antes do cofre, continuam legíveis até serem apagados.
- **Backups baixados** saem da proteção do sistema: abrem com a chave de recuperação, que é o que precisa ser guardado com cuidado.
- **App aberto pelo menu** (fora do serviço) roda sem o sandbox do systemd.
- **Root ou o kernel comprometido** quebram qualquer proteção enquanto a Moneta está ligada.
- **SSD e sistemas copy-on-write** (Btrfs) podem guardar blocos antigos depois que um arquivo é apagado ou sobrescrito, inclusive do `pluggy.json` migrado.
- **Perfil sem assinatura:** o perfil do iPhone não é assinado, e o iOS o mostra como "Não verificado". Na rede local, alguém mal-intencionado poderia trocar o perfil entregue em HTTP por outro. Mesmo assim, seria preciso que a vítima o instalasse e ativasse a confiança manualmente.
- **Relógio dos aparelhos:** a edição mais recente vence pela hora de cada aparelho. Um relógio muito adiantado faz as edições daquele aparelho vencerem as dos outros.
- **Windows:** a proteção por DPAPI foi escrita, mas ainda não foi testada num Windows real. Se o lacre falhar, a Moneta volta ao arquivo `0600`.

## Próximos passos

1. **Teste no Windows** do lacre por DPAPI e do modo cofre.
2. **Credenciais da Pluggy sob a senha** no modo cofre, para quem não precisa da sincronização com a Moneta trancada.
